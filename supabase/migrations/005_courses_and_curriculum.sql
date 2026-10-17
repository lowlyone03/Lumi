-- =============================================================================
-- Migration 005: Khóa học, Lộ trình (Bản nháp & Áp dụng không mất tiến độ),
--                Tiến độ gắn phiên bản nguồn, Thuật ngữ, Phụ đề & Thiết bị
-- Dự án: StudyFlow AI
-- Phụ thuộc: 001..004
-- =============================================================================

BEGIN;

-- 1. Kiểu Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'course_status') THEN
        CREATE TYPE app.course_status AS ENUM ('active', 'archived');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'draft_status') THEN
        CREATE TYPE app.draft_status AS ENUM ('generating', 'draft', 'applied', 'discarded', 'failed', 'stale');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'evidence_status') THEN
        CREATE TYPE app.evidence_status AS ENUM ('supported', 'partially_supported', 'missing_source');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'content_origin') THEN
        CREATE TYPE app.content_origin AS ENUM ('ai', 'user');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'lesson_source_role') THEN
        CREATE TYPE app.lesson_source_role AS ENUM ('primary', 'supplementary');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'lesson_progress_status') THEN
        CREATE TYPE app.lesson_progress_status AS ENUM ('not_started', 'in_progress', 'completed', 'needs_review');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'transcript_origin') THEN
        CREATE TYPE app.transcript_origin AS ENUM ('platform_caption', 'stt', 'user_upload', 'user_edit');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'device_platform') THEN
        CREATE TYPE app.device_platform AS ENUM ('android', 'web', 'windows');
    END IF;
END
$$;

-- 2. Bảng `app.courses` — Khóa học cá nhân (deadline `target_date` là NULLABLE, không gây áp lực)
CREATE TABLE IF NOT EXISTS app.courses (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 250),
    description text CHECK (description IS NULL OR char_length(description) <= 3000),
    goal text CHECK (goal IS NULL OR char_length(goal) <= 1000),
    target_date date,
    status app.course_status NOT NULL DEFAULT 'active',
    color text CHECK (color IS NULL OR char_length(color) <= 24),
    curriculum_revision integer NOT NULL DEFAULT 0 CHECK (curriculum_revision >= 0),
    last_studied_at timestamptz,
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_courses_owner_active
    ON app.courses(owner_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE TRIGGER tg_courses_immutable_owner
BEFORE UPDATE ON app.courses
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_courses_sync
BEFORE INSERT OR UPDATE ON app.courses
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- 3. Bảng `app.course_sources` — Liên kết nhiều-nhiều Khóa học <-> Nguồn (Khóa ngoại ghép)
CREATE TABLE IF NOT EXISTS app.course_sources (
    course_id uuid NOT NULL,
    source_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (course_id, source_id),
    FOREIGN KEY (course_id, owner_id) REFERENCES app.courses(id, owner_id) ON DELETE CASCADE,
    FOREIGN KEY (source_id, owner_id) REFERENCES app.sources(id, owner_id) ON DELETE CASCADE
);

CREATE TRIGGER tg_course_sources_immutable_owner
BEFORE UPDATE ON app.course_sources
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

-- 4. Bảng `app.curriculum_drafts` — Bản nháp lộ trình do AI đề xuất
CREATE TABLE IF NOT EXISTS app.curriculum_drafts (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    course_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    base_curriculum_revision integer NOT NULL CHECK (base_curriculum_revision >= 0),
    status app.draft_status NOT NULL DEFAULT 'generating',
    content jsonb NOT NULL DEFAULT '{}'::jsonb,
    model text,
    prompt_version text,
    ai_request_id uuid,
    applied_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (course_id, owner_id) REFERENCES app.courses(id, owner_id) ON DELETE CASCADE,
    FOREIGN KEY (ai_request_id, owner_id) REFERENCES app.ai_requests(id, user_id) ON DELETE SET NULL (ai_request_id)
);

CREATE TRIGGER tg_curriculum_drafts_immutable_owner
BEFORE UPDATE ON app.curriculum_drafts
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_curriculum_drafts_updated_at
BEFORE UPDATE ON app.curriculum_drafts
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- 5. Bảng `app.chapters` — Chương trong khóa học
CREATE TABLE IF NOT EXISTS app.chapters (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    course_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 250),
    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    UNIQUE (id, course_id, owner_id),
    FOREIGN KEY (course_id, owner_id) REFERENCES app.courses(id, owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chapters_course_pos
    ON app.chapters(course_id, position)
    WHERE deleted_at IS NULL;

CREATE TRIGGER tg_chapters_immutable_owner
BEFORE UPDATE ON app.chapters
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_chapters_sync
BEFORE INSERT OR UPDATE ON app.chapters
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- 6. Bảng `app.lessons` — Bài học (Khóa ngoại ghép 3 cột: chapter_id + course_id + owner_id)
-- Ngăn tuyệt đối việc gắn bài học vào một chương thuộc khóa học khác!
CREATE TABLE IF NOT EXISTS app.lessons (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    course_id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 250),
    objective text CHECK (objective IS NULL OR char_length(objective) <= 2000),
    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    estimated_minutes integer CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
    evidence_status app.evidence_status NOT NULL DEFAULT 'supported',
    origin app.content_origin NOT NULL DEFAULT 'ai',
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    UNIQUE (id, course_id, owner_id),
    FOREIGN KEY (chapter_id, course_id, owner_id)
        REFERENCES app.chapters(id, course_id, owner_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lessons_chapter_pos
    ON app.lessons(chapter_id, position)
    WHERE deleted_at IS NULL;

CREATE TRIGGER tg_lessons_immutable_owner
BEFORE UPDATE ON app.lessons
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_lessons_sync
BEFORE INSERT OR UPDATE ON app.lessons
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- Bổ sung khóa ngoại ghép từ `conversations` và `notes` (ở M04) sang `courses` và `lessons`
ALTER TABLE app.conversations
    ADD CONSTRAINT fk_conversations_course
    FOREIGN KEY (course_id, owner_id)
    REFERENCES app.courses(id, owner_id)
    ON DELETE SET NULL (course_id),
    ADD CONSTRAINT fk_conversations_lesson
    FOREIGN KEY (lesson_id, course_id, owner_id)
    REFERENCES app.lessons(id, course_id, owner_id)
    ON DELETE SET NULL (lesson_id);

ALTER TABLE app.notes
    ADD CONSTRAINT chk_notes_lesson_requires_course CHECK (
        lesson_id IS NULL OR course_id IS NOT NULL
    ),
    ADD CONSTRAINT fk_notes_course
    FOREIGN KEY (course_id, owner_id)
    REFERENCES app.courses(id, owner_id)
    ON DELETE SET NULL (course_id),
    ADD CONSTRAINT fk_notes_lesson
    FOREIGN KEY (lesson_id, course_id, owner_id)
    REFERENCES app.lessons(id, course_id, owner_id)
    ON DELETE SET NULL (lesson_id);

CREATE OR REPLACE FUNCTION app.tg_notes_scope_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.course_id IS NULL THEN
        NEW.lesson_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_notes_scope_guard
BEFORE INSERT OR UPDATE OF course_id ON app.notes
FOR EACH ROW EXECUTE FUNCTION app.tg_notes_scope_guard();

-- 7. Bảng `app.lesson_sources` — Liên kết Bài học <-> Phiên bản nguồn (`source_version_id` bắt buộc!)
CREATE TABLE IF NOT EXISTS app.lesson_sources (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    lesson_id uuid NOT NULL,
    source_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    locator jsonb CHECK (app.is_valid_locator(locator)),
    role app.lesson_source_role NOT NULL DEFAULT 'primary',
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (lesson_id, owner_id)
        REFERENCES app.lessons(id, owner_id)
        ON DELETE CASCADE,
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE CASCADE
);

CREATE TRIGGER tg_lesson_sources_immutable_owner
BEFORE UPDATE ON app.lesson_sources
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_lesson_sources_locator_bounds
BEFORE INSERT OR UPDATE ON app.lesson_sources
FOR EACH ROW EXECUTE FUNCTION app.tg_validate_locator_against_version();

-- 8. Bảng `app.topics` & `app.lesson_topics` — Chủ đề kiến thức
CREATE TABLE IF NOT EXISTS app.topics (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    course_id uuid,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
    description text CHECK (description IS NULL OR char_length(description) <= 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    FOREIGN KEY (course_id, owner_id)
        REFERENCES app.courses(id, owner_id)
        ON DELETE SET NULL (course_id)
);

-- Unique index trên biểu thức `lower(name)` với `NULLS NOT DISTINCT` cho `course_id`
CREATE UNIQUE INDEX IF NOT EXISTS uq_topics_owner_course_lower_name
    ON app.topics(owner_id, course_id, lower(btrim(name)))
    NULLS NOT DISTINCT;

CREATE TRIGGER tg_topics_immutable_owner
BEFORE UPDATE ON app.topics
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_topics_updated_at
BEFORE UPDATE ON app.topics
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS app.lesson_topics (
    lesson_id uuid NOT NULL,
    topic_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lesson_id, topic_id),
    FOREIGN KEY (lesson_id, owner_id) REFERENCES app.lessons(id, owner_id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id, owner_id) REFERENCES app.topics(id, owner_id) ON DELETE CASCADE
);

-- 9. Bảng `app.source_progress` & `app.lesson_progress` — Tiến độ gắn kèm `source_version_id`
CREATE TABLE IF NOT EXISTS app.source_progress (
    owner_id uuid NOT NULL,
    source_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    last_locator jsonb NOT NULL CHECK (app.is_valid_locator(last_locator)),
    last_opened_at timestamptz NOT NULL DEFAULT now(),
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, source_id),
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE CASCADE
);

CREATE TRIGGER tg_source_progress_immutable_owner
BEFORE UPDATE ON app.source_progress
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_source_progress_sync
BEFORE INSERT OR UPDATE ON app.source_progress
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

CREATE TABLE IF NOT EXISTS app.lesson_progress (
    owner_id uuid NOT NULL,
    lesson_id uuid NOT NULL,
    status app.lesson_progress_status NOT NULL DEFAULT 'not_started',
    last_source_id uuid,
    last_source_version_id uuid,
    last_locator jsonb CHECK (app.is_valid_locator(last_locator)),
    started_at timestamptz,
    completed_at timestamptz,
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, lesson_id),
    CONSTRAINT chk_lesson_progress_source_pair CHECK (
        (last_locator IS NULL OR last_source_version_id IS NOT NULL)
        AND (
            (last_source_version_id IS NULL AND last_source_id IS NULL)
            OR (last_source_version_id IS NOT NULL AND last_source_id IS NOT NULL)
        )
    ),
    FOREIGN KEY (lesson_id, owner_id)
        REFERENCES app.lessons(id, owner_id)
        ON DELETE CASCADE,
    FOREIGN KEY (last_source_version_id, last_source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE SET NULL (last_source_version_id, last_source_id)
);

CREATE TRIGGER tg_lesson_progress_immutable_owner
BEFORE UPDATE ON app.lesson_progress
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_lesson_progress_sync
BEFORE INSERT OR UPDATE ON app.lesson_progress
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- 10. Bảng `app.glossary_terms` — Từ điển thuật ngữ cá nhân (Unique index với `NULLS NOT DISTINCT`)
CREATE TABLE IF NOT EXISTS app.glossary_terms (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    course_id uuid,
    term text NOT NULL CHECK (char_length(btrim(term)) BETWEEN 1 AND 200),
    definition text NOT NULL CHECK (char_length(btrim(definition)) BETWEEN 1 AND 5000),
    example text CHECK (example IS NULL OR char_length(example) <= 3000),
    source_id uuid,
    source_version_id uuid,
    chunk_id uuid,
    locator jsonb CHECK (app.is_valid_locator(locator)),
    origin app.content_origin NOT NULL DEFAULT 'ai',
    user_edited boolean NOT NULL DEFAULT false,
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    CONSTRAINT chk_glossary_source_pair CHECK (
        (locator IS NULL OR source_version_id IS NOT NULL)
        AND (
            (source_version_id IS NULL AND source_id IS NULL AND chunk_id IS NULL)
            OR (source_version_id IS NOT NULL AND source_id IS NOT NULL)
        )
    ),
    FOREIGN KEY (course_id, owner_id)
        REFERENCES app.courses(id, owner_id)
        ON DELETE SET NULL (course_id),
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE SET NULL (source_version_id, source_id),
    FOREIGN KEY (chunk_id, source_version_id, owner_id)
        REFERENCES app.source_chunks(id, source_version_id, owner_id)
        ON DELETE SET NULL (chunk_id)
);

CREATE OR REPLACE FUNCTION app.tg_glossary_source_guard()
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

CREATE TRIGGER tg_glossary_source_guard
BEFORE INSERT OR UPDATE OF source_version_id ON app.glossary_terms
FOR EACH ROW EXECUTE FUNCTION app.tg_glossary_source_guard();

CREATE UNIQUE INDEX IF NOT EXISTS uq_glossary_owner_course_lower_term
    ON app.glossary_terms(owner_id, course_id, lower(btrim(term)))
    NULLS NOT DISTINCT
    WHERE deleted_at IS NULL;

CREATE TRIGGER tg_glossary_terms_immutable_owner
BEFORE UPDATE ON app.glossary_terms
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_glossary_terms_sync
BEFORE INSERT OR UPDATE ON app.glossary_terms
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- 11. Bảng `app.transcript_segments` — Phụ đề theo mốc thời gian (hỗ trợ tìm kiếm từ khóa nhảy tới giây)
CREATE TABLE IF NOT EXISTS app.transcript_segments (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    source_version_id uuid NOT NULL,
    source_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    seq integer NOT NULL CHECK (seq >= 0),
    start_ms bigint NOT NULL CHECK (start_ms >= 0),
    end_ms bigint NOT NULL CHECK (end_ms > start_ms),
    text text NOT NULL CHECK (char_length(btrim(text)) > 0),
    origin app.transcript_origin NOT NULL DEFAULT 'platform_caption',
    fts tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', app.immutable_unaccent(text))
    ) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_version_id, seq),
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_fts
    ON app.transcript_segments USING GIN (fts);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_time
    ON app.transcript_segments(source_version_id, start_ms);

-- 12. Bảng `app.user_devices` — Thiết bị & Push Token
CREATE TABLE IF NOT EXISTS app.user_devices (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    platform app.device_platform NOT NULL,
    device_name text,
    push_token text,
    app_version text,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_id, push_token)
);

CREATE TRIGGER tg_user_devices_immutable_owner
BEFORE UPDATE ON app.user_devices
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_user_devices_updated_at
BEFORE UPDATE ON app.user_devices
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- =============================================================================
-- 13. RLS & Phân quyền
-- =============================================================================

ALTER TABLE app.courses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.courses             FORCE ROW LEVEL SECURITY;

ALTER TABLE app.course_sources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.course_sources      FORCE ROW LEVEL SECURITY;

ALTER TABLE app.curriculum_drafts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.curriculum_drafts   FORCE ROW LEVEL SECURITY;

ALTER TABLE app.chapters            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chapters            FORCE ROW LEVEL SECURITY;

ALTER TABLE app.lessons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.lessons             FORCE ROW LEVEL SECURITY;

ALTER TABLE app.lesson_sources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.lesson_sources      FORCE ROW LEVEL SECURITY;

ALTER TABLE app.topics              ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.topics              FORCE ROW LEVEL SECURITY;

ALTER TABLE app.lesson_topics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.lesson_topics       FORCE ROW LEVEL SECURITY;

ALTER TABLE app.source_progress     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.source_progress     FORCE ROW LEVEL SECURITY;

ALTER TABLE app.lesson_progress     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.lesson_progress     FORCE ROW LEVEL SECURITY;

ALTER TABLE app.glossary_terms      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.glossary_terms      FORCE ROW LEVEL SECURITY;

ALTER TABLE app.transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.transcript_segments FORCE ROW LEVEL SECURITY;

ALTER TABLE app.user_devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_devices        FORCE ROW LEVEL SECURITY;

CREATE POLICY pol_courses_own ON app.courses
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_course_sources_own ON app.course_sources
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_curriculum_drafts_own ON app.curriculum_drafts
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_chapters_own ON app.chapters
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_lessons_own ON app.lessons
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_lesson_sources_own ON app.lesson_sources
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_topics_own ON app.topics
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_lesson_topics_own ON app.lesson_topics
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_source_progress_own ON app.source_progress
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_lesson_progress_own ON app.lesson_progress
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_glossary_terms_own ON app.glossary_terms
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_transcript_segments_read ON app.transcript_segments
    FOR SELECT TO app_api, app_worker
    USING (owner_id = app.current_user_id());

CREATE POLICY pol_transcript_segments_worker_write ON app.transcript_segments
    FOR ALL TO app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_user_devices_own ON app.user_devices
    FOR ALL TO app_api
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
    app.courses, app.course_sources, app.curriculum_drafts,
    app.chapters, app.lessons, app.lesson_sources,
    app.topics, app.lesson_topics, app.source_progress,
    app.lesson_progress, app.glossary_terms, app.user_devices
TO app_api;

GRANT SELECT ON app.transcript_segments TO app_api, app_worker;
GRANT INSERT, UPDATE, DELETE ON app.transcript_segments TO app_worker;

COMMIT;
