-- =============================================================================
-- Migration 008: Ôn tập (`study_outlines`, `flashcards`, `card_schedules`, `card_reviews`)
--                & Công cụ Tổ chức Tùy chọn (`study_goals`, `study_plan_items`,
--                `reminders`, `study_sessions`)
-- Dự án: StudyFlow AI
-- Phụ thuộc: 001..007
-- Bảo đảm:
--   - Tắt lịch (`flashcard_decks.schedule_enabled = false`) hoặc ẩn công cụ
--     không làm mất bộ thẻ hay lịch đã có.
--   - Gửi lặp `card_reviews.event_id` chỉ cập nhật lịch đúng 1 lần.
-- =============================================================================

BEGIN;

-- 1. Kiểu Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'outline_status') THEN
        CREATE TYPE app.outline_status AS ENUM ('analyzing', 'ready', 'failed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'outline_coverage') THEN
        CREATE TYPE app.outline_coverage AS ENUM ('covered', 'partial', 'missing', 'unknown');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'flashcard_origin') THEN
        CREATE TYPE app.flashcard_origin AS ENUM ('ai', 'user', 'from_review_item');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'flashcard_status') THEN
        CREATE TYPE app.flashcard_status AS ENUM ('draft', 'active', 'suspended');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'card_schedule_state') THEN
        CREATE TYPE app.card_schedule_state AS ENUM ('new', 'learning', 'review', 'relearning');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'goal_metric') THEN
        CREATE TYPE app.goal_metric AS ENUM ('sessions', 'minutes', 'lessons', 'reviews');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'goal_status') THEN
        CREATE TYPE app.goal_status AS ENUM ('active', 'paused', 'reduced', 'completed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'plan_item_kind') THEN
        CREATE TYPE app.plan_item_kind AS ENUM ('study', 'review', 'deadline');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'plan_item_status') THEN
        CREATE TYPE app.plan_item_status AS ENUM ('planned', 'done', 'skipped', 'rescheduled', 'canceled');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'reminder_kind') THEN
        CREATE TYPE app.reminder_kind AS ENUM ('study', 'review', 'custom');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'session_mode') THEN
        CREATE TYPE app.session_mode AS ENUM ('free', 'focus_timer');
    END IF;
END
$$;

-- 2. Bảng `app.study_outlines` & `app.outline_items` — Đề cương ôn tập & đối chiếu thiếu tài liệu
CREATE TABLE IF NOT EXISTS app.study_outlines (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    course_id uuid NOT NULL,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 250),
    raw_text text NOT NULL CHECK (char_length(btrim(raw_text)) BETWEEN 1 AND 50000),
    status app.outline_status NOT NULL DEFAULT 'analyzing',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    FOREIGN KEY (course_id, owner_id) REFERENCES app.courses(id, owner_id) ON DELETE CASCADE
);

CREATE TRIGGER tg_study_outlines_immutable_owner
BEFORE UPDATE ON app.study_outlines
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_study_outlines_updated_at
BEFORE UPDATE ON app.study_outlines
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS app.outline_items (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    outline_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    position integer NOT NULL CHECK (position >= 1),
    text text NOT NULL CHECK (char_length(btrim(text)) > 0),
    coverage app.outline_coverage NOT NULL DEFAULT 'unknown',
    coverage_assessed_by app.assessed_by NOT NULL DEFAULT 'ai',
    matched_chunk_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (outline_id, position),
    FOREIGN KEY (outline_id, owner_id) REFERENCES app.study_outlines(id, owner_id) ON DELETE CASCADE
);

-- 3. Bảng `app.flashcard_decks` & `app.flashcards`
-- Phân biệt `visible_tools.flashcards` (hiển thị công cụ) với `schedule_enabled` (ôn theo lịch ngắt quãng)
CREATE TABLE IF NOT EXISTS app.flashcard_decks (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    course_id uuid,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 250),
    description text CHECK (description IS NULL OR char_length(description) <= 2000),
    schedule_enabled boolean NOT NULL DEFAULT false,
    schedule_paused_at timestamptz,
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

CREATE TRIGGER tg_flashcard_decks_immutable_owner
BEFORE UPDATE ON app.flashcard_decks
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_flashcard_decks_sync
BEFORE INSERT OR UPDATE ON app.flashcard_decks
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

CREATE TABLE IF NOT EXISTS app.flashcards (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    deck_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    front text NOT NULL CHECK (char_length(btrim(front)) BETWEEN 1 AND 2000),
    back text NOT NULL CHECK (char_length(btrim(back)) BETWEEN 1 AND 5000),
    source_id uuid,
    source_version_id uuid,
    chunk_id uuid,
    locator jsonb CHECK (app.is_valid_locator(locator)),
    origin app.flashcard_origin NOT NULL DEFAULT 'ai',
    status app.flashcard_status NOT NULL DEFAULT 'active',
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    CONSTRAINT chk_flashcards_source_pair CHECK (
        (locator IS NULL OR source_version_id IS NOT NULL)
        AND (
            (source_version_id IS NULL AND source_id IS NULL AND chunk_id IS NULL)
            OR (source_version_id IS NOT NULL AND source_id IS NOT NULL)
        )
    ),
    FOREIGN KEY (deck_id, owner_id)
        REFERENCES app.flashcard_decks(id, owner_id)
        ON DELETE CASCADE,
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE SET NULL (source_version_id, source_id),
    FOREIGN KEY (chunk_id, source_version_id, owner_id)
        REFERENCES app.source_chunks(id, source_version_id, owner_id)
        ON DELETE SET NULL (chunk_id)
);

CREATE OR REPLACE FUNCTION app.tg_flashcard_source_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.source_version_id IS NULL THEN
        NEW.source_id := NULL;
        NEW.chunk_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_flashcard_source_guard
BEFORE INSERT OR UPDATE OF source_version_id ON app.flashcards
FOR EACH ROW EXECUTE FUNCTION app.tg_flashcard_source_guard();

CREATE TRIGGER tg_flashcards_immutable_owner
BEFORE UPDATE ON app.flashcards
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_flashcards_sync
BEFORE INSERT OR UPDATE ON app.flashcards
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- 4. Bảng `app.card_schedules` & `app.card_reviews`
CREATE TABLE IF NOT EXISTS app.card_schedules (
    card_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    state app.card_schedule_state NOT NULL DEFAULT 'new',
    due_at timestamptz NOT NULL DEFAULT now(),
    interval_days integer NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
    repetitions integer NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
    ease_factor numeric(4,2) NOT NULL DEFAULT 2.50 CHECK (ease_factor >= 1.30),
    lapses integer NOT NULL DEFAULT 0 CHECK (lapses >= 0),
    algorithm_version text NOT NULL DEFAULT 'sm2-3btn-v1',
    last_reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (card_id, owner_id),
    FOREIGN KEY (card_id, owner_id) REFERENCES app.flashcards(id, owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_card_schedules_due
    ON app.card_schedules(owner_id, due_at ASC);

CREATE TABLE IF NOT EXISTS app.card_reviews (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    event_id uuid NOT NULL,
    card_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 3), -- 1: Khó, 2: Bình thường, 3: Dễ
    reviewed_at timestamptz NOT NULL DEFAULT now(),
    prev_state jsonb NOT NULL,
    next_state jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_id, event_id),
    FOREIGN KEY (card_id, owner_id) REFERENCES app.flashcards(id, owner_id) ON DELETE CASCADE
);

-- Hàm ghi nhận ôn thẻ Flashcard nguyên tử & Idempotent theo `event_id`
CREATE OR REPLACE FUNCTION app.record_card_review(
    p_event_id uuid,
    p_card_id uuid,
    p_rating smallint
)
RETURNS app.card_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_uid uuid := app.current_user_id();
    v_existing app.card_reviews;
    v_sched app.card_schedules;
    v_prev jsonb;
    v_next_interval integer;
    v_next_reps integer;
    v_next_ef numeric(4,2);
    v_next_lapses integer;
    v_next_state app.card_schedule_state;
    v_next_due timestamptz;
    v_rev app.card_reviews;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: active user required'
            USING ERRCODE = '42501';
    END IF;

    IF p_rating NOT BETWEEN 1 AND 3 THEN
        RAISE EXCEPTION 'INVALID_RATING: rating must be 1, 2, or 3'
            USING ERRCODE = '22023';
    END IF;

    -- Khóa lịch thẻ của người dùng (hoặc khởi tạo nếu chưa có)
    INSERT INTO app.card_schedules (card_id, owner_id)
    VALUES (p_card_id, v_uid)
    ON CONFLICT (card_id, owner_id) DO NOTHING;

    SELECT * INTO v_sched
    FROM app.card_schedules
    WHERE card_id = p_card_id AND owner_id = v_uid
    FOR UPDATE;

    -- Nếu event_id đã được xử lý trước đó -> trả về bản ghi cũ, không cộng lịch 2 lần!
    SELECT * INTO v_existing
    FROM app.card_reviews
    WHERE owner_id = v_uid AND event_id = p_event_id;

    IF FOUND THEN
        RETURN v_existing;
    END IF;

    v_prev := jsonb_build_object(
        'state', v_sched.state,
        'due_at', v_sched.due_at,
        'interval_days', v_sched.interval_days,
        'repetitions', v_sched.repetitions,
        'ease_factor', v_sched.ease_factor,
        'lapses', v_sched.lapses
    );

    -- Ánh xạ 3 nút (1: Khó, 2: Bình thường, 3: Dễ) sang SM-2 rút gọn
    IF p_rating = 1 THEN
        v_next_reps     := 0;
        v_next_interval := 1;
        v_next_ef       := GREATEST(1.30, v_sched.ease_factor - 0.20);
        v_next_lapses   := v_sched.lapses + 1;
        v_next_state    := 'relearning';
    ELSIF p_rating = 2 THEN
        v_next_reps     := v_sched.repetitions + 1;
        v_next_interval := CASE
            WHEN v_sched.repetitions = 0 THEN 1
            WHEN v_sched.repetitions = 1 THEN 3
            ELSE GREATEST(1, round(v_sched.interval_days * v_sched.ease_factor)::integer)
        END;
        v_next_ef       := v_sched.ease_factor;
        v_next_lapses   := v_sched.lapses;
        v_next_state    := 'review';
    ELSE
        v_next_reps     := v_sched.repetitions + 1;
        v_next_interval := CASE
            WHEN v_sched.repetitions = 0 THEN 2
            WHEN v_sched.repetitions = 1 THEN 5
            ELSE GREATEST(2, round(v_sched.interval_days * (v_sched.ease_factor + 0.15))::integer)
        END;
        v_next_ef       := LEAST(3.00, v_sched.ease_factor + 0.10);
        v_next_lapses   := v_sched.lapses;
        v_next_state    := 'review';
    END IF;

    v_next_due := now() + make_interval(days => v_next_interval);

    UPDATE app.card_schedules
    SET state            = v_next_state,
        due_at           = v_next_due,
        interval_days    = v_next_interval,
        repetitions      = v_next_reps,
        ease_factor      = v_next_ef,
        lapses           = v_next_lapses,
        last_reviewed_at = now(),
        updated_at       = now()
    WHERE card_id = p_card_id AND owner_id = v_uid;

    INSERT INTO app.card_reviews (
        event_id, card_id, owner_id, rating, reviewed_at, prev_state, next_state
    )
    VALUES (
        p_event_id, p_card_id, v_uid, p_rating, now(), v_prev,
        jsonb_build_object(
            'state', v_next_state,
            'due_at', v_next_due,
            'interval_days', v_next_interval,
            'repetitions', v_next_reps,
            'ease_factor', v_next_ef,
            'lapses', v_next_lapses
        )
    )
    RETURNING * INTO v_rev;

    RETURN v_rev;
END;
$$;

GRANT EXECUTE ON FUNCTION app.record_card_review(uuid, uuid, smallint) TO app_api;

-- 5. Nhóm H: Công cụ Tổ chức Việc học Tùy chọn (`study_goals`, `study_plan_items`, `reminders`, `study_sessions`)
CREATE TABLE IF NOT EXISTS app.study_goals (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    course_id uuid,
    metric app.goal_metric NOT NULL DEFAULT 'sessions',
    target_value integer NOT NULL CHECK (target_value > 0),
    week_start date NOT NULL,
    status app.goal_status NOT NULL DEFAULT 'active',
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

CREATE TRIGGER tg_study_goals_immutable_owner
BEFORE UPDATE ON app.study_goals
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_study_goals_sync
BEFORE INSERT OR UPDATE ON app.study_goals
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

CREATE TABLE IF NOT EXISTS app.study_plan_items (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    course_id uuid,
    lesson_id uuid,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 250),
    kind app.plan_item_kind NOT NULL DEFAULT 'study',
    planned_date date NOT NULL,
    planned_start time,
    planned_minutes integer CHECK (planned_minutes IS NULL OR planned_minutes > 0),
    deadline_at timestamptz,
    status app.plan_item_status NOT NULL DEFAULT 'planned',
    rescheduled_from_id uuid,
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    FOREIGN KEY (course_id, owner_id)
        REFERENCES app.courses(id, owner_id)
        ON DELETE SET NULL (course_id),
    FOREIGN KEY (lesson_id, owner_id)
        REFERENCES app.lessons(id, owner_id)
        ON DELETE SET NULL (lesson_id),
    FOREIGN KEY (rescheduled_from_id, owner_id)
        REFERENCES app.study_plan_items(id, owner_id)
        ON DELETE SET NULL (rescheduled_from_id)
);

CREATE TRIGGER tg_study_plan_items_immutable_owner
BEFORE UPDATE ON app.study_plan_items
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_study_plan_items_sync
BEFORE INSERT OR UPDATE ON app.study_plan_items
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

CREATE TABLE IF NOT EXISTS app.reminders (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    kind app.reminder_kind NOT NULL DEFAULT 'study',
    course_id uuid,
    weekdays smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'::smallint[],
    local_time time NOT NULL DEFAULT '20:00:00',
    timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    enabled boolean NOT NULL DEFAULT true,
    next_run_at timestamptz,
    last_sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (course_id, owner_id)
        REFERENCES app.courses(id, owner_id)
        ON DELETE SET NULL (course_id)
);

CREATE TRIGGER tg_reminders_immutable_owner
BEFORE UPDATE ON app.reminders
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_reminders_updated_at
BEFORE UPDATE ON app.reminders
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS app.study_sessions (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    course_id uuid,
    lesson_id uuid,
    source_id uuid,
    mode app.session_mode NOT NULL DEFAULT 'free',
    planned_minutes integer CHECK (planned_minutes IS NULL OR planned_minutes > 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    active_seconds integer NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
    self_confidence smallint CHECK (self_confidence IS NULL OR self_confidence BETWEEN 1 AND 5),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (course_id, owner_id)
        REFERENCES app.courses(id, owner_id)
        ON DELETE SET NULL (course_id),
    FOREIGN KEY (lesson_id, owner_id)
        REFERENCES app.lessons(id, owner_id)
        ON DELETE SET NULL (lesson_id),
    FOREIGN KEY (source_id, owner_id)
        REFERENCES app.sources(id, owner_id)
        ON DELETE SET NULL (source_id)
);

CREATE TRIGGER tg_study_sessions_immutable_owner
BEFORE UPDATE ON app.study_sessions
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_study_sessions_updated_at
BEFORE UPDATE ON app.study_sessions
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- =============================================================================
-- 6. RLS & Phân quyền
-- =============================================================================

ALTER TABLE app.study_outlines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.study_outlines   FORCE ROW LEVEL SECURITY;

ALTER TABLE app.outline_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outline_items    FORCE ROW LEVEL SECURITY;

ALTER TABLE app.flashcard_decks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.flashcard_decks  FORCE ROW LEVEL SECURITY;

ALTER TABLE app.flashcards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.flashcards       FORCE ROW LEVEL SECURITY;

ALTER TABLE app.card_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.card_schedules   FORCE ROW LEVEL SECURITY;

ALTER TABLE app.card_reviews     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.card_reviews     FORCE ROW LEVEL SECURITY;

ALTER TABLE app.study_goals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.study_goals      FORCE ROW LEVEL SECURITY;

ALTER TABLE app.study_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.study_plan_items FORCE ROW LEVEL SECURITY;

ALTER TABLE app.reminders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reminders        FORCE ROW LEVEL SECURITY;

ALTER TABLE app.study_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.study_sessions   FORCE ROW LEVEL SECURITY;

CREATE POLICY pol_study_outlines_own ON app.study_outlines
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_outline_items_own ON app.outline_items
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_flashcard_decks_own ON app.flashcard_decks
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_flashcards_own ON app.flashcards
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_card_schedules_read ON app.card_schedules
    FOR SELECT TO app_api
    USING (owner_id = app.current_user_id());

CREATE POLICY pol_card_reviews_read ON app.card_reviews
    FOR SELECT TO app_api
    USING (owner_id = app.current_user_id());

CREATE POLICY pol_study_goals_own ON app.study_goals
    FOR ALL TO app_api
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_study_plan_items_own ON app.study_plan_items
    FOR ALL TO app_api
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_reminders_own ON app.reminders
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_study_sessions_own ON app.study_sessions
    FOR ALL TO app_api
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
    app.study_outlines, app.outline_items,
    app.flashcard_decks, app.flashcards,
    app.study_goals, app.study_plan_items,
    app.reminders, app.study_sessions
TO app_api;

GRANT SELECT ON app.card_schedules, app.card_reviews TO app_api;

COMMIT;
