-- =============================================================================
-- Migration 007: Luyện tập (`quizzes`, `quiz_versions`, `questions`, `question_keys`,
--                `quiz_attempts`, `attempt_answers`, `review_items`)
-- Dự án: StudyFlow AI
-- Phụ thuộc: 001..006
-- Bảo đảm:
--   - Đề đã phát hành (`published`) là BẤT BIẾN (chặn UPDATE/DELETE câu hỏi & đáp án).
--   - `question_keys` tách riêng, `app_api` không có quyền SELECT trực tiếp.
--   - `attempt_answers.question_id` bắt buộc thuộc đúng `quiz_version_id` của lần làm.
--   - `app.submit_attempt()` khóa hàng `FOR UPDATE`, chấm trong 1 transaction,
--     nộp lại trả kết quả đã có, xử lý rõ bài `expired`.
-- =============================================================================

BEGIN;

-- 1. Kiểu Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'quiz_origin') THEN
        CREATE TYPE app.quiz_origin AS ENUM ('ai', 'user', 'mixed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'quiz_version_status') THEN
        CREATE TYPE app.quiz_version_status AS ENUM ('generating', 'draft', 'published', 'retired', 'failed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'attempt_mode') THEN
        CREATE TYPE app.attempt_mode AS ENUM ('practice', 'timed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'question_type') THEN
        CREATE TYPE app.question_type AS ENUM ('single_choice', 'multiple_choice', 'true_false');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'difficulty_level') THEN
        CREATE TYPE app.difficulty_level AS ENUM ('easy', 'medium', 'hard');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'attempt_status') THEN
        CREATE TYPE app.attempt_status AS ENUM ('in_progress', 'submitted', 'expired', 'abandoned');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'review_reason') THEN
        CREATE TYPE app.review_reason AS ENUM ('wrong_answer', 'unsure', 'user_added');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'review_item_status') THEN
        CREATE TYPE app.review_item_status AS ENUM ('open', 'practicing', 'resolved');
    END IF;
END
$$;

-- 2. Bảng `app.quizzes` — Bộ đề luyện tập (có thể gắn khóa học hoặc nguồn độc lập)
CREATE TABLE IF NOT EXISTS app.quizzes (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    course_id uuid,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 250),
    scope jsonb NOT NULL DEFAULT '{}'::jsonb,
    origin app.quiz_origin NOT NULL DEFAULT 'ai',
    active_version_id uuid,
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    FOREIGN KEY (course_id, owner_id)
        REFERENCES app.courses(id, owner_id)
        ON DELETE SET NULL (course_id)
);

CREATE TRIGGER tg_quizzes_immutable_owner
BEFORE UPDATE ON app.quizzes
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_quizzes_sync
BEFORE INSERT OR UPDATE ON app.quizzes
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- 3. Bảng `app.quiz_versions` — Phiên bản đề (sau khi `published` là bất biến)
CREATE TABLE IF NOT EXISTS app.quiz_versions (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    quiz_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    version_no integer NOT NULL CHECK (version_no >= 1),
    status app.quiz_version_status NOT NULL DEFAULT 'generating',
    default_mode app.attempt_mode NOT NULL DEFAULT 'practice',
    time_limit_seconds integer CHECK (time_limit_seconds IS NULL OR time_limit_seconds > 0),
    question_count integer NOT NULL DEFAULT 0 CHECK (question_count >= 0),
    difficulty_requested app.difficulty_level,
    based_on_version_id uuid,
    model text,
    prompt_version text,
    generation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (quiz_id, version_no),
    UNIQUE (id, owner_id),
    UNIQUE (id, quiz_id, owner_id),
    CONSTRAINT chk_quiz_version_timed_limit CHECK (
        default_mode = 'practice' OR time_limit_seconds IS NOT NULL
    ),
    FOREIGN KEY (quiz_id, owner_id) REFERENCES app.quizzes(id, owner_id) ON DELETE CASCADE,
    FOREIGN KEY (based_on_version_id, quiz_id, owner_id)
        REFERENCES app.quiz_versions(id, quiz_id, owner_id)
        ON DELETE SET NULL (based_on_version_id)
);

CREATE TRIGGER tg_quiz_versions_immutable_owner
BEFORE UPDATE ON app.quiz_versions
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_quiz_versions_updated_at
BEFORE UPDATE ON app.quiz_versions
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- Khóa ngoại ghép DEFERRABLE cho `quizzes.active_version_id`
ALTER TABLE app.quizzes
    DROP CONSTRAINT IF EXISTS fk_quizzes_active_version;

ALTER TABLE app.quizzes
    ADD CONSTRAINT fk_quizzes_active_version
    FOREIGN KEY (active_version_id, id, owner_id)
    REFERENCES app.quiz_versions(id, quiz_id, owner_id)
    DEFERRABLE INITIALLY DEFERRED;

-- 4. Bảng `app.questions` — Câu hỏi (không chứa đáp án)
CREATE TABLE IF NOT EXISTS app.questions (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    quiz_version_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    position integer NOT NULL CHECK (position >= 1),
    type app.question_type NOT NULL DEFAULT 'single_choice',
    stem text NOT NULL CHECK (char_length(btrim(stem)) > 0),
    options jsonb NOT NULL CHECK (
        jsonb_typeof(options) = 'array'
        AND jsonb_array_length(options) BETWEEN 2 AND 6
    ),
    difficulty app.difficulty_level,
    origin app.content_origin NOT NULL DEFAULT 'ai',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (quiz_version_id, position),
    UNIQUE (id, owner_id),
    UNIQUE (id, quiz_version_id, owner_id),
    FOREIGN KEY (quiz_version_id, owner_id)
        REFERENCES app.quiz_versions(id, owner_id)
        ON DELETE CASCADE
);

CREATE TRIGGER tg_questions_immutable_owner
BEFORE UPDATE ON app.questions
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_questions_updated_at
BEFORE UPDATE ON app.questions
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- 5. Bảng `app.question_keys` — Đáp án & lời giải (Tách riêng, ẩn khỏi `app_api`)
CREATE TABLE IF NOT EXISTS app.question_keys (
    question_id uuid PRIMARY KEY,
    quiz_version_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    answer_key jsonb NOT NULL,
    explanation text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (question_id, quiz_version_id, owner_id)
        REFERENCES app.questions(id, quiz_version_id, owner_id)
        ON DELETE CASCADE
);

CREATE TRIGGER tg_question_keys_immutable_owner
BEFORE UPDATE ON app.question_keys
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

-- 6. Bảng `app.question_topics` & `app.question_sources`
CREATE TABLE IF NOT EXISTS app.question_topics (
    question_id uuid NOT NULL,
    topic_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    PRIMARY KEY (question_id, topic_id),
    FOREIGN KEY (question_id, owner_id) REFERENCES app.questions(id, owner_id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id, owner_id) REFERENCES app.topics(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.question_sources (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    question_id uuid NOT NULL,
    quiz_version_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    chunk_id uuid,
    source_id uuid,
    source_version_id uuid,
    locator_snapshot jsonb NOT NULL CHECK (app.is_valid_locator(locator_snapshot)),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (question_id, quiz_version_id, owner_id)
        REFERENCES app.questions(id, quiz_version_id, owner_id)
        ON DELETE CASCADE,
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE SET NULL (source_version_id, source_id),
    FOREIGN KEY (chunk_id, source_version_id, owner_id)
        REFERENCES app.source_chunks(id, source_version_id, owner_id)
        ON DELETE SET NULL (chunk_id)
);

-- =============================================================================
-- 7. Trigger bảo đảm tính BẤT BIẾN của `quiz_versions` sau khi đã `published`
-- =============================================================================

CREATE OR REPLACE FUNCTION app.tg_guard_published_quiz_content()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
DECLARE
    v_ver_id uuid;
    v_status app.quiz_version_status;
BEGIN
    v_ver_id := COALESCE(OLD.quiz_version_id, NEW.quiz_version_id);

    SELECT status INTO v_status
    FROM app.quiz_versions
    WHERE id = v_ver_id;

    -- Cho phép xóa khi cả `quiz_versions` đang bị CASCADE xóa
    IF TG_OP = 'DELETE' AND NOT FOUND THEN
        RETURN OLD;
    END IF;

    IF v_status IN ('published', 'retired') THEN
        RAISE EXCEPTION 'QUIZ_VERSION_IMMUTABLE: cannot modify questions or keys of % quiz_version %; create a new version instead',
            v_status, v_ver_id
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_questions_immutable_when_published
BEFORE INSERT OR UPDATE OR DELETE ON app.questions
FOR EACH ROW EXECUTE FUNCTION app.tg_guard_published_quiz_content();

CREATE TRIGGER tg_question_keys_immutable_when_published
BEFORE INSERT OR UPDATE OR DELETE ON app.question_keys
FOR EACH ROW EXECUTE FUNCTION app.tg_guard_published_quiz_content();

CREATE TRIGGER tg_question_sources_immutable_when_published
BEFORE INSERT OR UPDATE OR DELETE ON app.question_sources
FOR EACH ROW EXECUTE FUNCTION app.tg_guard_published_quiz_content();

-- 8. Bảng `app.quiz_attempts` — Lần làm bài gắn với `quiz_version_id`
CREATE TABLE IF NOT EXISTS app.quiz_attempts (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    quiz_version_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    mode app.attempt_mode NOT NULL DEFAULT 'practice',
    status app.attempt_status NOT NULL DEFAULT 'in_progress',
    time_limit_seconds integer CHECK (time_limit_seconds IS NULL OR time_limit_seconds > 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    deadline_at timestamptz,
    submitted_at timestamptz,
    finalized_at timestamptz,
    score numeric(6,2) CHECK (score IS NULL OR score >= 0),
    max_score numeric(6,2) CHECK (max_score IS NULL OR max_score >= 0),
    retry_of_attempt_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    UNIQUE (id, quiz_version_id, owner_id),
    FOREIGN KEY (quiz_version_id, owner_id)
        REFERENCES app.quiz_versions(id, owner_id)
        ON DELETE CASCADE,
    FOREIGN KEY (retry_of_attempt_id, owner_id)
        REFERENCES app.quiz_attempts(id, owner_id)
        ON DELETE SET NULL (retry_of_attempt_id)
);

-- Tối đa 1 lần làm đang `in_progress` cho mỗi (owner_id, quiz_version_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_attempts_single_in_progress
    ON app.quiz_attempts(owner_id, quiz_version_id)
    WHERE status = 'in_progress';

CREATE TRIGGER tg_quiz_attempts_immutable_owner
BEFORE UPDATE ON app.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_quiz_attempts_updated_at
BEFORE UPDATE ON app.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- Chặn sửa các cột cấu hình của lần làm sau khi đã bắt đầu
CREATE OR REPLACE FUNCTION app.tg_guard_quiz_attempt_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
    IF NEW.quiz_version_id IS DISTINCT FROM OLD.quiz_version_id
       OR NEW.mode IS DISTINCT FROM OLD.mode
       OR NEW.time_limit_seconds IS DISTINCT FROM OLD.time_limit_seconds
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
    THEN
        RAISE EXCEPTION 'IMMUTABLE_ATTEMPT_CONFIG: quiz_version_id, mode, started_at, deadline_at cannot be modified'
            USING ERRCODE = '42501';
    END IF;

    IF OLD.status IN ('submitted', 'expired', 'abandoned') AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'ATTEMPT_ALREADY_FINALIZED: cannot transition from % to %', OLD.status, NEW.status
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_quiz_attempts_guard
BEFORE UPDATE ON app.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION app.tg_guard_quiz_attempt_columns();

-- 9. Bảng `app.attempt_answers` — Câu trả lời của từng câu hỏi
-- Khóa ngoại ghép bảo đảm `question_id` thuộc ĐÚNG `quiz_version_id` của lần làm!
CREATE TABLE IF NOT EXISTS app.attempt_answers (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    attempt_id uuid NOT NULL,
    quiz_version_id uuid NOT NULL,
    question_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    response jsonb,
    is_correct boolean,
    score numeric(6,2),
    hints_used integer NOT NULL DEFAULT 0 CHECK (hints_used >= 0),
    marked_unsure boolean NOT NULL DEFAULT false,
    saved_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, question_id),
    UNIQUE (id, owner_id),
    FOREIGN KEY (attempt_id, quiz_version_id, owner_id)
        REFERENCES app.quiz_attempts(id, quiz_version_id, owner_id)
        ON DELETE CASCADE,
    FOREIGN KEY (question_id, quiz_version_id, owner_id)
        REFERENCES app.questions(id, quiz_version_id, owner_id)
        ON DELETE RESTRICT
);

CREATE TRIGGER tg_attempt_answers_immutable_owner
BEFORE UPDATE ON app.attempt_answers
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_attempt_answers_updated_at
BEFORE UPDATE ON app.attempt_answers
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- Trigger chặn lưu đáp án nháp sau khi bài đã nộp hoặc quá hạn (`deadline_at + 30 giây`)
CREATE OR REPLACE FUNCTION app.tg_guard_attempt_answer_save()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
DECLARE
    v_att app.quiz_attempts;
BEGIN
    SELECT * INTO v_att
    FROM app.quiz_attempts
    WHERE id = NEW.attempt_id;

    IF v_att.status <> 'in_progress' THEN
        RAISE EXCEPTION 'ATTEMPT_CLOSED: cannot save answer when attempt status is %', v_att.status
            USING ERRCODE = '22023';
    END IF;

    IF v_att.deadline_at IS NOT NULL AND now() > (v_att.deadline_at + interval '30 seconds') THEN
        RAISE EXCEPTION 'ATTEMPT_DEADLINE_PASSED: deadline % passed for attempt %',
            v_att.deadline_at, NEW.attempt_id
            USING ERRCODE = '22023';
    END IF;

    NEW.saved_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_attempt_answers_save_window
BEFORE INSERT ON app.attempt_answers
FOR EACH ROW EXECUTE FUNCTION app.tg_guard_attempt_answer_save();

CREATE TRIGGER tg_attempt_answers_update_window
BEFORE UPDATE OF response, hints_used, marked_unsure ON app.attempt_answers
FOR EACH ROW EXECUTE FUNCTION app.tg_guard_attempt_answer_save();

-- 10. Bảng `app.review_items` — Mục cần ôn lại (CHỈ tạo khi người học chủ động chọn "Lưu để ôn")
CREATE TABLE IF NOT EXISTS app.review_items (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    course_id uuid,
    topic_id uuid,
    question_id uuid,
    attempt_answer_id uuid,
    source_id uuid,
    source_version_id uuid,
    locator jsonb CHECK (app.is_valid_locator(locator)),
    reason app.review_reason NOT NULL DEFAULT 'user_added',
    personal_note text CHECK (personal_note IS NULL OR char_length(personal_note) <= 3000),
    status app.review_item_status NOT NULL DEFAULT 'open',
    resolved_at timestamptz,
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    CONSTRAINT chk_review_items_source_pair CHECK (
        (locator IS NULL OR source_version_id IS NOT NULL)
        AND (
            (source_version_id IS NULL AND source_id IS NULL)
            OR (source_version_id IS NOT NULL AND source_id IS NOT NULL)
        )
    ),
    FOREIGN KEY (course_id, owner_id)
        REFERENCES app.courses(id, owner_id)
        ON DELETE SET NULL (course_id),
    FOREIGN KEY (topic_id, owner_id)
        REFERENCES app.topics(id, owner_id)
        ON DELETE SET NULL (topic_id),
    FOREIGN KEY (question_id, owner_id)
        REFERENCES app.questions(id, owner_id)
        ON DELETE SET NULL (question_id),
    FOREIGN KEY (attempt_answer_id, owner_id)
        REFERENCES app.attempt_answers(id, owner_id)
        ON DELETE SET NULL (attempt_answer_id),
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE SET NULL (source_version_id, source_id)
);

CREATE TRIGGER tg_review_items_immutable_owner
BEFORE UPDATE ON app.review_items
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_review_items_sync
BEFORE INSERT OR UPDATE ON app.review_items
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- =============================================================================
-- 11. Hàm bắt đầu & nộp bài nguyên tử (`app.start_attempt` & `app.submit_attempt`)
-- =============================================================================

CREATE OR REPLACE FUNCTION app.start_quiz_attempt(
    p_quiz_version_id uuid,
    p_requested_mode app.attempt_mode DEFAULT NULL
)
RETURNS app.quiz_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_uid uuid := app.current_user_id();
    v_ver app.quiz_versions;
    v_existing app.quiz_attempts;
    v_mode app.attempt_mode;
    v_limit integer;
    v_deadline timestamptz;
    v_att app.quiz_attempts;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: active user required'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_ver
    FROM app.quiz_versions
    WHERE id = p_quiz_version_id AND owner_id = v_uid;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: quiz_version % not found', p_quiz_version_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_ver.status <> 'published' THEN
        RAISE EXCEPTION 'INVALID_STATE: quiz_version % must be published before starting attempt', p_quiz_version_id
            USING ERRCODE = '22023';
    END IF;

    -- Nếu đã có attempt `in_progress` thì trả về luôn
    SELECT * INTO v_existing
    FROM app.quiz_attempts
    WHERE owner_id = v_uid AND quiz_version_id = p_quiz_version_id AND status = 'in_progress';

    IF FOUND THEN
        RETURN v_existing;
    END IF;

    v_mode := COALESCE(p_requested_mode, v_ver.default_mode);
    IF v_mode = 'timed' THEN
        v_limit := COALESCE(v_ver.time_limit_seconds, 900); -- 15 phút mặc định nếu chọn bấm giờ
        v_deadline := now() + make_interval(secs => v_limit);
    ELSE
        v_limit := NULL;
        v_deadline := NULL;
    END IF;

    INSERT INTO app.quiz_attempts (
        quiz_version_id, owner_id, mode, status,
        time_limit_seconds, started_at, deadline_at
    )
    VALUES (
        p_quiz_version_id, v_uid, v_mode, 'in_progress',
        v_limit, now(), v_deadline
    )
    RETURNING * INTO v_att;

    RETURN v_att;
END;
$$;

-- Nộp bài & chấm điểm trong MỘT giao dịch có khóa hàng `FOR UPDATE`
-- Nộp lại cùng `attempt_id` trả về kết quả đã chấm!
CREATE OR REPLACE FUNCTION app.submit_quiz_attempt(
    p_attempt_id uuid
)
RETURNS app.quiz_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_uid uuid := app.current_user_id();
    v_att app.quiz_attempts;
    v_final_status app.attempt_status;
    v_total_questions integer;
    v_correct_count integer := 0;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: active user required'
            USING ERRCODE = '42501';
    END IF;

    -- 1. Khóa hàng lần làm bài để tuần tự hóa mọi yêu cầu nộp song song
    SELECT * INTO v_att
    FROM app.quiz_attempts
    WHERE id = p_attempt_id AND owner_id = v_uid
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: quiz_attempt % not found', p_attempt_id
            USING ERRCODE = 'P0002';
    END IF;

    -- 2. Nếu đã nộp hoặc đã hết giờ trước đó -> trả về ngay kết quả cũ (Idempotent)
    IF v_att.status IN ('submitted', 'expired') THEN
        RETURN v_att;
    END IF;

    IF v_att.status = 'abandoned' THEN
        RAISE EXCEPTION 'INVALID_STATE: abandoned attempt % cannot be submitted', p_attempt_id
            USING ERRCODE = '22023';
    END IF;

    -- 3. Xác định nộp đúng hạn (`submitted`) hay quá hạn (`expired` — vẫn chấm các câu đã lưu trước hạn)
    IF v_att.deadline_at IS NOT NULL AND now() > (v_att.deadline_at + interval '30 seconds') THEN
        v_final_status := 'expired';
    ELSE
        v_final_status := 'submitted';
    END IF;

    -- 4. Chấm điểm từng câu đã trả lời dựa trên `app.question_keys`
    UPDATE app.attempt_answers aa
    SET is_correct = (aa.response IS NOT NULL AND aa.response = qk.answer_key),
        score      = CASE WHEN (aa.response IS NOT NULL AND aa.response = qk.answer_key) THEN 1.0 ELSE 0.0 END
    FROM app.question_keys qk
    WHERE aa.attempt_id = p_attempt_id
      AND aa.question_id = qk.question_id
      AND aa.quiz_version_id = qk.quiz_version_id;

    SELECT count(*) INTO v_total_questions
    FROM app.questions
    WHERE quiz_version_id = v_att.quiz_version_id;

    SELECT COALESCE(sum(score), 0) INTO v_correct_count
    FROM app.attempt_answers
    WHERE attempt_id = p_attempt_id;

    -- 5. Lưu kết quả tổng và đóng lần làm
    UPDATE app.quiz_attempts
    SET status       = v_final_status,
        submitted_at = COALESCE(submitted_at, now()),
        finalized_at = now(),
        score        = v_correct_count,
        max_score    = v_total_questions
    WHERE id = p_attempt_id
    RETURNING * INTO v_att;

    RETURN v_att;
END;
$$;

GRANT EXECUTE ON FUNCTION app.start_quiz_attempt(uuid, app.attempt_mode) TO app_api;
GRANT EXECUTE ON FUNCTION app.submit_quiz_attempt(uuid) TO app_api;

-- =============================================================================
-- 12. RLS & Phân quyền bảng/cột
-- =============================================================================

ALTER TABLE app.quizzes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quizzes          FORCE ROW LEVEL SECURITY;

ALTER TABLE app.quiz_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quiz_versions    FORCE ROW LEVEL SECURITY;

ALTER TABLE app.questions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.questions        FORCE ROW LEVEL SECURITY;

ALTER TABLE app.question_keys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.question_keys    FORCE ROW LEVEL SECURITY;

ALTER TABLE app.question_topics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.question_topics  FORCE ROW LEVEL SECURITY;

ALTER TABLE app.question_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.question_sources FORCE ROW LEVEL SECURITY;

ALTER TABLE app.quiz_attempts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quiz_attempts    FORCE ROW LEVEL SECURITY;

ALTER TABLE app.attempt_answers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.attempt_answers  FORCE ROW LEVEL SECURITY;

ALTER TABLE app.review_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.review_items     FORCE ROW LEVEL SECURITY;

CREATE POLICY pol_quizzes_own ON app.quizzes
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_quiz_versions_own ON app.quiz_versions
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_questions_own ON app.questions
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

-- `question_keys`: chỉ `app_worker` (lúc tạo đề) hoặc hàm `SECURITY DEFINER` được truy cập;
-- `app_api` KHÔNG có policy SELECT trực tiếp để tránh lộ đáp án trước khi nộp!
CREATE POLICY pol_question_keys_worker ON app.question_keys
    FOR ALL TO app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_question_topics_own ON app.question_topics
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_question_sources_own ON app.question_sources
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_quiz_attempts_own ON app.quiz_attempts
    FOR ALL TO app_api
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_attempt_answers_own ON app.attempt_answers
    FOR ALL TO app_api
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_review_items_own ON app.review_items
    FOR ALL TO app_api
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

-- Grants:
GRANT SELECT, INSERT, UPDATE, DELETE ON app.quizzes, app.quiz_versions, app.questions, app.question_topics, app.question_sources TO app_api, app_worker;

-- Đặc biệt: KHÔNG cấp SELECT `question_keys` cho `app_api`!
GRANT SELECT, INSERT, UPDATE, DELETE ON app.question_keys TO app_worker;

-- `quiz_attempts`: `app_api` chỉ được đọc, không được UPDATE trực tiếp `score`, `submitted_at`, `status`
GRANT SELECT ON app.quiz_attempts TO app_api;

-- `attempt_answers`: `app_api` chỉ được INSERT và UPDATE `response`, `hints_used`, `marked_unsure` (KHÔNG được sửa `is_correct`, `score`)
GRANT SELECT ON app.attempt_answers TO app_api;
GRANT INSERT (id, attempt_id, quiz_version_id, question_id, owner_id, response, hints_used, marked_unsure)
    ON app.attempt_answers TO app_api;
GRANT UPDATE (response, hints_used, marked_unsure)
    ON app.attempt_answers TO app_api;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.review_items TO app_api;

COMMIT;
