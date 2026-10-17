-- =============================================================================
-- Migration 003: Học liệu (`sources`, `source_versions`), Tác vụ nền (`jobs`),
--                Đoạn văn (`source_chunks`), Cảnh báo & Thẻ (`tags`)
-- Dự án: StudyFlow AI
-- Phụ thuộc: 001_foundation.sql, 002_users_access_quota.sql
-- =============================================================================

BEGIN;

-- 1. Kiểu Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'source_kind') THEN
        CREATE TYPE app.source_kind AS ENUM ('pdf', 'video_upload', 'video_link', 'transcript_only');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'source_status') THEN
        CREATE TYPE app.source_status AS ENUM ('pending', 'processing', 'ready', 'failed', 'archived');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'source_version_status') THEN
        CREATE TYPE app.source_version_status AS ENUM (
            'uploading', 'uploaded', 'processing', 'ready', 'failed', 'superseded', 'deleted'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'job_type') THEN
        CREATE TYPE app.job_type AS ENUM (
            'ingest_pdf', 'ingest_video', 'ingest_transcript',
            'reembed', 'purge_source', 'purge_account', 'gc_storage'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'job_status') THEN
        CREATE TYPE app.job_status AS ENUM (
            'queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'canceled'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'job_stage') THEN
        CREATE TYPE app.job_stage AS ENUM (
            'queued', 'extracting', 'chunking', 'embedding', 'validating', 'completed'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'warning_kind') THEN
        CREATE TYPE app.warning_kind AS ENUM (
            'page_no_text', 'low_audio_quality', 'truncated', 'image_only_content', 'unsupported_content'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'tag_kind') THEN
        CREATE TYPE app.tag_kind AS ENUM ('subject', 'custom');
    END IF;
END
$$;

-- 2. Bảng `app.sources` — Nguồn học liệu độc lập với khóa học
CREATE TABLE IF NOT EXISTS app.sources (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    kind app.source_kind NOT NULL,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    description text CHECK (description IS NULL OR char_length(description) <= 2000),
    language text CHECK (language IS NULL OR char_length(language) BETWEEN 2 AND 16),
    original_url text CHECK (original_url IS NULL OR original_url ~ '^https://'),
    active_version_id uuid,
    status app.source_status NOT NULL DEFAULT 'pending',
    is_favorite boolean NOT NULL DEFAULT false,
    rights_confirmed_at timestamptz NOT NULL DEFAULT now(),
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    CONSTRAINT chk_source_url_by_kind CHECK (
        (kind = 'video_link' AND original_url IS NOT NULL)
        OR (kind <> 'video_link')
    )
);

CREATE INDEX IF NOT EXISTS idx_sources_owner_active
    ON app.sources(owner_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sources_change_seq
    ON app.sources(owner_id, change_seq);

CREATE TRIGGER tg_sources_immutable_owner
BEFORE UPDATE ON app.sources
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_sources_sync
BEFORE INSERT OR UPDATE ON app.sources
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- 3. Bảng `app.source_versions` — Mỗi lần tải lên hoặc cập nhật phiên bản học liệu
CREATE TABLE IF NOT EXISTS app.source_versions (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    source_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    version_no integer NOT NULL CHECK (version_no >= 1),
    storage_path text UNIQUE,
    mime_type text,
    size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
    content_hash text CHECK (content_hash IS NULL OR char_length(content_hash) BETWEEN 32 AND 128),
    page_count integer CHECK (page_count IS NULL OR page_count > 0),
    duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms > 0),
    status app.source_version_status NOT NULL DEFAULT 'uploading',
    chunking_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id, version_no),
    UNIQUE (id, owner_id),
    UNIQUE (id, source_id, owner_id),
    FOREIGN KEY (source_id, owner_id) REFERENCES app.sources(id, owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_versions_source
    ON app.source_versions(source_id, version_no DESC);

CREATE TRIGGER tg_source_versions_immutable_owner
BEFORE UPDATE ON app.source_versions
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_source_versions_updated_at
BEFORE UPDATE ON app.source_versions
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- Chặn sửa source_id của source_versions và chặn chuyển trạng thái ngược từ `deleted`
CREATE OR REPLACE FUNCTION app.tg_source_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
    IF NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.version_no IS DISTINCT FROM OLD.version_no THEN
        RAISE EXCEPTION 'IMMUTABLE_COLUMN: source_id and version_no cannot be changed on source_versions'
            USING ERRCODE = '42501';
    END IF;

    IF OLD.status = 'deleted' AND NEW.status <> 'deleted' THEN
        RAISE EXCEPTION 'INVALID_STATE_TRANSITION: deleted source_version cannot transition to %', NEW.status
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_source_versions_guard
BEFORE UPDATE ON app.source_versions
FOR EACH ROW EXECUTE FUNCTION app.tg_source_version_guard();

-- Khóa ngoại ghép DEFERRABLE cho `sources.active_version_id`:
-- Bảo đảm `active_version_id` bắt buộc thuộc đúng `sources.id` và cùng `owner_id`!
ALTER TABLE app.sources
    DROP CONSTRAINT IF EXISTS fk_sources_active_version;

ALTER TABLE app.sources
    ADD CONSTRAINT fk_sources_active_version
    FOREIGN KEY (active_version_id, id, owner_id)
    REFERENCES app.source_versions(id, source_id, owner_id)
    DEFERRABLE INITIALLY DEFERRED;

-- 4. Bảng `app.jobs` — Tác vụ nền có cơ chế nhận việc nguyên tử & fencing token (`lock_token`)
CREATE TABLE IF NOT EXISTS app.jobs (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    job_type app.job_type NOT NULL,
    source_id uuid,
    source_version_id uuid,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status app.job_status NOT NULL DEFAULT 'queued',
    stage app.job_stage NOT NULL DEFAULT 'queued',
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
    next_retry_at timestamptz NOT NULL DEFAULT now(),
    locked_by text,
    lock_token uuid,
    lease_expires_at timestamptz,
    heartbeat_at timestamptz,
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
    error_code text,
    error_message text,
    stats jsonb NOT NULL DEFAULT '{}'::jsonb,
    queued_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_id, job_type, idempotency_key),
    UNIQUE (id, owner_id),
    CONSTRAINT chk_jobs_source_pair CHECK (
        (source_version_id IS NULL AND source_id IS NULL)
        OR (source_version_id IS NOT NULL AND source_id IS NOT NULL)
    ),
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE SET NULL (source_version_id, source_id)
);

-- Một phiên bản học liệu chỉ có tối đa 1 job ingest đang hoạt động (`queued` / `running` / `cancel_requested`)
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_active_ingest_per_version
    ON app.jobs(source_version_id)
    WHERE source_version_id IS NOT NULL
      AND job_type IN ('ingest_pdf', 'ingest_video', 'ingest_transcript')
      AND status IN ('queued', 'running', 'cancel_requested');

CREATE INDEX IF NOT EXISTS idx_jobs_claim_queue
    ON app.jobs(status, next_retry_at, queued_at)
    WHERE status IN ('queued', 'running', 'cancel_requested');

CREATE TRIGGER tg_jobs_immutable_owner
BEFORE UPDATE ON app.jobs
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_jobs_updated_at
BEFORE UPDATE ON app.jobs
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- 5. Bảng `app.source_chunks` — Đoạn văn bản đã bóc tách (tách biệt với bảng vector để không khóa số chiều)
CREATE TABLE IF NOT EXISTS app.source_chunks (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    source_version_id uuid NOT NULL,
    source_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    content text NOT NULL CHECK (char_length(btrim(content)) > 0),
    heading text,
    token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
    locator jsonb NOT NULL CHECK (app.is_valid_locator(locator)),
    fts tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', app.immutable_unaccent(coalesce(heading, '') || ' ' || content))
    ) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_version_id, chunk_index),
    UNIQUE (id, owner_id),
    UNIQUE (id, source_version_id),
    UNIQUE (id, source_version_id, owner_id),
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_chunks_version
    ON app.source_chunks(source_version_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_source_chunks_owner_source
    ON app.source_chunks(owner_id, source_id);

CREATE INDEX IF NOT EXISTS idx_source_chunks_fts
    ON app.source_chunks USING GIN (fts);

CREATE TRIGGER tg_source_chunks_immutable_owner
BEFORE UPDATE ON app.source_chunks
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_source_chunks_updated_at
BEFORE UPDATE ON app.source_chunks
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- Trigger kiểm tra `locator` đối chiếu với `page_count` / `duration_ms` và loại nguồn
CREATE OR REPLACE FUNCTION app.tg_validate_locator_against_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
DECLARE
    v_ver app.source_versions;
    v_kind app.source_kind;
    v_loc_type text;
    v_page bigint;
    v_page_end bigint;
    v_end_ms bigint;
BEGIN
    IF NEW.locator IS NULL OR NEW.source_version_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_ver
    FROM app.source_versions
    WHERE id = NEW.source_version_id;

    SELECT s.kind INTO v_kind
    FROM app.sources s
    WHERE s.id = v_ver.source_id;

    v_loc_type := NEW.locator ->> 'type';

    IF v_kind = 'pdf' AND v_loc_type <> 'pdf_page' THEN
        RAISE EXCEPTION 'LOCATOR_MISMATCH: pdf source requires pdf_page locator, got %', v_loc_type
            USING ERRCODE = '22023';
    END IF;

    IF v_kind IN ('video_upload', 'video_link', 'transcript_only') AND v_loc_type <> 'video_time' THEN
        RAISE EXCEPTION 'LOCATOR_MISMATCH: video/transcript source requires video_time locator, got %', v_loc_type
            USING ERRCODE = '22023';
    END IF;

    IF v_loc_type = 'pdf_page' AND v_ver.page_count IS NOT NULL THEN
        v_page := (NEW.locator ->> 'page')::bigint;
        v_page_end := COALESCE((NEW.locator ->> 'page_end')::bigint, v_page);
        IF v_page > v_ver.page_count OR v_page_end > v_ver.page_count THEN
            RAISE EXCEPTION 'LOCATOR_OUT_OF_RANGE: page %..% exceeds page_count %',
                v_page, v_page_end, v_ver.page_count
                USING ERRCODE = '22023';
        END IF;
    ELSIF v_loc_type = 'video_time' AND v_ver.duration_ms IS NOT NULL THEN
        v_end_ms := (NEW.locator ->> 'end_ms')::bigint;
        IF v_end_ms > v_ver.duration_ms THEN
            RAISE EXCEPTION 'LOCATOR_OUT_OF_RANGE: end_ms % exceeds duration_ms %',
                v_end_ms, v_ver.duration_ms
                USING ERRCODE = '22023';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_source_chunks_locator_bounds
BEFORE INSERT OR UPDATE ON app.source_chunks
FOR EACH ROW EXECUTE FUNCTION app.tg_validate_locator_against_version();

-- 6. Bảng `app.source_warnings` — Cảnh báo trang không có chữ, âm thanh kém...
CREATE TABLE IF NOT EXISTS app.source_warnings (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    source_version_id uuid NOT NULL,
    source_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    kind app.warning_kind NOT NULL,
    message text NOT NULL,
    locator jsonb CHECK (app.is_valid_locator(locator)),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE CASCADE
);

-- 7. Bảng `app.tags` & `app.source_tags` (Khóa ngoại ghép ngăn gắn thẻ của người khác)
CREATE TABLE IF NOT EXISTS app.tags (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    color text CHECK (color IS NULL OR char_length(color) <= 24),
    kind app.tag_kind NOT NULL DEFAULT 'custom',
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_owner_lower_name
    ON app.tags(owner_id, lower(btrim(name)))
    WHERE deleted_at IS NULL;

CREATE TRIGGER tg_tags_immutable_owner
BEFORE UPDATE ON app.tags
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_tags_sync
BEFORE INSERT OR UPDATE ON app.tags
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

CREATE TABLE IF NOT EXISTS app.source_tags (
    source_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, tag_id),
    FOREIGN KEY (source_id, owner_id) REFERENCES app.sources(id, owner_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id, owner_id) REFERENCES app.tags(id, owner_id) ON DELETE CASCADE
);

CREATE TRIGGER tg_source_tags_immutable_owner
BEFORE UPDATE ON app.source_tags
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

-- =============================================================================
-- 8. Cơ chế Worker nhận Job nguyên tử & Fencing Token (`lock_token`)
-- =============================================================================

-- 8.1. Nhận 1 job từ hàng đợi (chỉ lấy job của tài khoản đang `active`)
CREATE OR REPLACE FUNCTION app.claim_next_job(
    p_worker_id text,
    p_lease_seconds integer DEFAULT 120
)
RETURNS app.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_job app.jobs;
BEGIN
    IF CURRENT_USER NOT IN ('app_worker', 'postgres') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: only app_worker can claim jobs'
            USING ERRCODE = '42501';
    END IF;

    WITH candidate AS (
        SELECT j.id
        FROM app.jobs j
        JOIN app.user_access ua ON ua.user_id = j.owner_id
        WHERE ua.status = 'active'
          AND (
              (j.status = 'queued' AND j.next_retry_at <= now())
              OR (j.status = 'running' AND j.lease_expires_at < now() AND j.attempt_count < j.max_attempts)
          )
        ORDER BY j.queued_at ASC
        FOR UPDATE OF j SKIP LOCKED
        LIMIT 1
    )
    UPDATE app.jobs j
    SET status           = 'running',
        locked_by        = p_worker_id,
        lock_token       = extensions.gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => GREATEST(p_lease_seconds, 15)),
        heartbeat_at     = now(),
        started_at       = COALESCE(j.started_at, now()),
        attempt_count    = j.attempt_count + 1
    FROM candidate c
    WHERE j.id = c.id
    RETURNING j.* INTO v_job;

    RETURN v_job;
END;
$$;

-- 8.2. Kiểm tra fencing token trước khi worker ghi dữ liệu (chunks, embeddings, hoàn tất job)
CREATE OR REPLACE FUNCTION app.assert_job_lock(
    p_job_id uuid,
    p_lock_token uuid
)
RETURNS app.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_job app.jobs;
    v_ua_status app.account_status;
    v_src_deleted timestamptz;
BEGIN
    SELECT * INTO v_job
    FROM app.jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'JOB_NOT_FOUND: job % does not exist', p_job_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_job.status <> 'running' THEN
        RAISE EXCEPTION 'JOB_FENCED: job % is in status %, expected running', p_job_id, v_job.status
            USING ERRCODE = '40001';
    END IF;

    IF v_job.lock_token IS DISTINCT FROM p_lock_token THEN
        RAISE EXCEPTION 'JOB_FENCED: stale lock_token for job %', p_job_id
            USING ERRCODE = '40001';
    END IF;

    IF v_job.lease_expires_at < now() THEN
        RAISE EXCEPTION 'JOB_LEASE_EXPIRED: lease expired at % for job %', v_job.lease_expires_at, p_job_id
            USING ERRCODE = '40001';
    END IF;

    SELECT status INTO v_ua_status
    FROM app.user_access
    WHERE user_id = v_job.owner_id;

    IF v_ua_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'ACCOUNT_SUSPENDED: owner of job % is not active', p_job_id
            USING ERRCODE = '42501';
    END IF;

    IF v_job.source_id IS NOT NULL THEN
        SELECT deleted_at INTO v_src_deleted
        FROM app.sources
        WHERE id = v_job.source_id;

        IF v_src_deleted IS NOT NULL THEN
            RAISE EXCEPTION 'SOURCE_DELETED: source % was deleted while job % was running',
                v_job.source_id, p_job_id
                USING ERRCODE = '40001';
        END IF;
    END IF;

    RETURN v_job;
END;
$$;

-- 8.3. Gia hạn lease (Heartbeat) + chuyển bước (`stage`)
CREATE OR REPLACE FUNCTION app.heartbeat_job(
    p_job_id uuid,
    p_lock_token uuid,
    p_stage app.job_stage DEFAULT NULL,
    p_stats jsonb DEFAULT NULL,
    p_lease_seconds integer DEFAULT 120
)
RETURNS app.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_job app.jobs;
BEGIN
    PERFORM app.assert_job_lock(p_job_id, p_lock_token);

    UPDATE app.jobs
    SET lease_expires_at = now() + make_interval(secs => GREATEST(p_lease_seconds, 15)),
        heartbeat_at     = now(),
        stage            = COALESCE(p_stage, stage),
        stats            = COALESCE(p_stats, stats)
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    RETURN v_job;
END;
$$;

-- 8.4. Worker ghi chunk an toàn kèm kiểm tra `lock_token` (Idempotent theo `chunk_index`)
CREATE OR REPLACE FUNCTION app.worker_upsert_chunk(
    p_job_id uuid,
    p_lock_token uuid,
    p_chunk_index integer,
    p_content text,
    p_heading text,
    p_token_count integer,
    p_locator jsonb
)
RETURNS app.source_chunks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_job app.jobs;
    v_chunk app.source_chunks;
BEGIN
    v_job := app.assert_job_lock(p_job_id, p_lock_token);

    IF v_job.source_version_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_JOB: job % has no source_version_id', p_job_id
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO app.source_chunks (
        source_version_id, source_id, owner_id,
        chunk_index, content, heading, token_count, locator
    )
    VALUES (
        v_job.source_version_id, v_job.source_id, v_job.owner_id,
        p_chunk_index, p_content, p_heading, p_token_count, p_locator
    )
    ON CONFLICT (source_version_id, chunk_index) DO UPDATE
    SET content     = EXCLUDED.content,
        heading     = EXCLUDED.heading,
        token_count = EXCLUDED.token_count,
        locator     = EXCLUDED.locator,
        updated_at  = now()
    RETURNING * INTO v_chunk;

    RETURN v_chunk;
END;
$$;

-- 8.5. Hoàn tất Job xử lý học liệu: chuyển version cũ sang `superseded`, bản mới `ready`,
-- cập nhật `sources.active_version_id` và `jobs.status = 'succeeded'` trong MỘT giao dịch!
CREATE OR REPLACE FUNCTION app.complete_ingest_job(
    p_job_id uuid,
    p_lock_token uuid,
    p_stats jsonb DEFAULT NULL
)
RETURNS app.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_job app.jobs;
    v_chunk_count integer;
    v_src app.sources;
BEGIN
    v_job := app.assert_job_lock(p_job_id, p_lock_token);

    SELECT count(*) INTO v_chunk_count
    FROM app.source_chunks
    WHERE source_version_id = v_job.source_version_id;

    IF v_chunk_count = 0 THEN
        RAISE EXCEPTION 'EMPTY_EXTRACTION: cannot mark source_version % ready with 0 chunks',
            v_job.source_version_id
            USING ERRCODE = '22023';
    END IF;

    -- Đánh dấu phiên bản active cũ (nếu có) thành `superseded`
    UPDATE app.source_versions
    SET status = 'superseded'
    WHERE source_id = v_job.source_id
      AND id <> v_job.source_version_id
      AND status = 'ready';

    -- Đánh dấu phiên bản mới `ready`
    UPDATE app.source_versions
    SET status       = 'ready',
        processed_at = now()
    WHERE id = v_job.source_version_id;

    -- Cập nhật nguồn sang `ready` và trỏ `active_version_id` vào bản mới
    SELECT * INTO v_src
    FROM app.sources
    WHERE id = v_job.source_id
    FOR UPDATE;

    UPDATE app.sources
    SET active_version_id = v_job.source_version_id,
        status            = 'ready',
        revision          = v_src.revision + 1
    WHERE id = v_job.source_id;

    -- Hoàn tất job
    UPDATE app.jobs
    SET status           = 'succeeded',
        stage            = 'completed',
        stats            = COALESCE(p_stats, stats),
        finished_at      = now(),
        lock_token       = NULL,
        lease_expires_at = NULL
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION app.claim_next_job(text, integer) TO app_worker;
GRANT EXECUTE ON FUNCTION app.assert_job_lock(uuid, uuid) TO app_worker;
GRANT EXECUTE ON FUNCTION app.heartbeat_job(uuid, uuid, app.job_stage, jsonb, integer) TO app_worker;
GRANT EXECUTE ON FUNCTION app.worker_upsert_chunk(uuid, uuid, integer, text, text, integer, jsonb) TO app_worker;
GRANT EXECUTE ON FUNCTION app.complete_ingest_job(uuid, uuid, jsonb) TO app_worker;

-- =============================================================================
-- 9. RLS & Phân quyền bảng/cột cho Nhóm Học liệu
-- =============================================================================

ALTER TABLE app.sources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sources         FORCE ROW LEVEL SECURITY;

ALTER TABLE app.source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.source_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE app.jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jobs            FORCE ROW LEVEL SECURITY;

ALTER TABLE app.source_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.source_chunks   FORCE ROW LEVEL SECURITY;

ALTER TABLE app.source_warnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.source_warnings FORCE ROW LEVEL SECURITY;

ALTER TABLE app.tags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tags            FORCE ROW LEVEL SECURITY;

ALTER TABLE app.source_tags     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.source_tags     FORCE ROW LEVEL SECURITY;

CREATE POLICY pol_sources_own ON app.sources
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_source_versions_own ON app.source_versions
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_jobs_own_or_admin ON app.jobs
    FOR SELECT TO app_api, app_worker
    USING (owner_id = app.current_user_id() OR app.is_admin());

CREATE POLICY pol_jobs_write_own ON app.jobs
    FOR INSERT TO app_api, app_worker
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_jobs_update_own ON app.jobs
    FOR UPDATE TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_source_chunks_read ON app.source_chunks
    FOR SELECT TO app_api, app_worker
    USING (owner_id = app.current_user_id());

CREATE POLICY pol_source_chunks_worker_write ON app.source_chunks
    FOR ALL TO app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_source_warnings_read ON app.source_warnings
    FOR SELECT TO app_api, app_worker
    USING (owner_id = app.current_user_id());

CREATE POLICY pol_source_warnings_worker_write ON app.source_warnings
    FOR ALL TO app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_tags_own ON app.tags
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_source_tags_own ON app.source_tags
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

-- Grants chi tiết:
GRANT SELECT, INSERT ON app.sources TO app_api, app_worker;
GRANT UPDATE (title, description, language, is_favorite, status, active_version_id, deleted_at, revision)
    ON app.sources TO app_api, app_worker;

GRANT SELECT, INSERT ON app.source_versions TO app_api, app_worker;
GRANT UPDATE (status, mime_type, size_bytes, content_hash, page_count, duration_ms, chunking_config, processed_at)
    ON app.source_versions TO app_api, app_worker;

GRANT SELECT, INSERT ON app.jobs TO app_api, app_worker;
GRANT UPDATE (status, stage, next_retry_at, error_code, error_message, stats, finished_at)
    ON app.jobs TO app_api, app_worker;

-- Chỉ worker được ghi `source_chunks` và `source_warnings`; `app_api` chỉ đọc!
GRANT SELECT ON app.source_chunks, app.source_warnings TO app_api, app_worker;
GRANT INSERT, UPDATE, DELETE ON app.source_chunks, app.source_warnings TO app_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.tags, app.source_tags TO app_api;
GRANT SELECT ON app.tags, app.source_tags TO app_worker;

COMMIT;
