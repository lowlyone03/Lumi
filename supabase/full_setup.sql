-- =============================================================================
-- FULL SETUP MIGRATIONS (001 -> 008) CHO SUPABASE CLOUD
-- Du an: StudyFlow AI
-- Huong dan: Mo Supabase Dashboard -> SQL Editor -> Dan toan bo noi dung -> Bam RUN
-- =============================================================================

BEGIN;

-- =============================================================================
-- MIGRATION: 001_foundation.sql
-- =============================================================================

-- =============================================================================
-- Migration 001: Nền tảng (Schema, Extensions, Roles, Helpers, Sync & Locator)
-- Dự án: StudyFlow AI (Supabase PostgreSQL + pgvector)
-- Lưu ý: Chạy trong giao dịch. Schema `app` KHÔNG được mở qua PostgREST Data API.
-- =============================================================================

BEGIN;

-- 1. Extensions
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Cho phép tìm hàm của extensions trong search_path
GRANT USAGE ON SCHEMA extensions TO PUBLIC;

-- 2. Schema nghiệp vụ tách biệt khỏi `public`
CREATE SCHEMA IF NOT EXISTS app;

-- 3. Roles cho Backend (FastAPI) và Worker
-- Trên Supabase, kết nối pooler/direct đăng nhập bằng `postgres` (hoặc role tương đương),
-- sau đó mỗi transaction chạy `SET LOCAL ROLE app_api` hoặc `SET LOCAL ROLE app_worker`.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
        CREATE ROLE app_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
        CREATE ROLE app_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
END
$$;

-- Cho phép postgres (và authenticator nếu có trên Supabase) chuyển sang 2 role này
GRANT app_api, app_worker TO postgres;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
        EXECUTE 'GRANT app_api, app_worker TO authenticator';
    END IF;
END
$$;

-- 4. Khóa chặt quyền trên schema `app` với client trực tiếp (anon / authenticated / public)
REVOKE ALL ON SCHEMA app FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON SCHEMA app FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON SCHEMA app FROM authenticated';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA app TO app_api, app_worker;
GRANT USAGE ON SCHEMA extensions TO app_api, app_worker;

-- Đảm bảo bảng/hàm tạo mới trong `app` không tự động mở cho PUBLIC
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- 5. Sequence toàn cục cho đồng bộ đa thiết bị (`change_seq`)
CREATE SEQUENCE IF NOT EXISTS app.global_change_seq AS bigint START WITH 1 INCREMENT BY 1;
GRANT USAGE, SELECT ON SEQUENCE app.global_change_seq TO app_api, app_worker;

-- 6. Hàm cấu hình văn bản tiếng Việt không dấu (phục vụ Full-Text Search)
CREATE OR REPLACE FUNCTION app.immutable_unaccent(input_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = extensions, pg_temp
AS $$
    SELECT extensions.unaccent('extensions.unaccent'::regdictionary, input_text);
$$;

GRANT EXECUTE ON FUNCTION app.immutable_unaccent(text) TO app_api, app_worker;

-- 7. Hàm đọc user_id từ cấu hình phiên (`app.user_id`)
-- M02 sẽ nâng cấp `app.current_user_id()` để kiểm tra trạng thái tài khoản `active`.
CREATE OR REPLACE FUNCTION app.raw_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE PARALLEL SAFE
SET search_path = app, pg_temp
AS $$
DECLARE
    v_raw text;
BEGIN
    v_raw := nullif(current_setting('app.user_id', true), '');
    IF v_raw IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN v_raw::uuid;
EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION app.raw_user_id() TO app_api, app_worker;

-- 8. Kiểm tra cấu trúc `locator` (pdf_page / video_time)
-- Bắt buộc: có `type`, không chứa khóa lạ, giá trị số hợp lệ.
CREATE OR REPLACE FUNCTION app.is_valid_locator(loc jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path = app, pg_temp
AS $$
DECLARE
    v_type text;
    v_page bigint;
    v_page_end bigint;
    v_start_ms bigint;
    v_end_ms bigint;
BEGIN
    IF loc IS NULL THEN
        RETURN true;
    END IF;

    IF jsonb_typeof(loc) <> 'object' THEN
        RETURN false;
    END IF;

    v_type := loc ->> 'type';
    IF v_type IS NULL THEN
        RETURN false;
    END IF;

    IF v_type = 'pdf_page' THEN
        -- Chỉ cho phép khóa: type, page, page_end
        IF NOT (loc - ARRAY['type', 'page', 'page_end'] = '{}'::jsonb) THEN
            RETURN false;
        END IF;

        IF jsonb_typeof(loc -> 'page') <> 'number' THEN
            RETURN false;
        END IF;

        -- Phải là số nguyên >= 1
        IF (loc ->> 'page') !~ '^[0-9]+$' THEN
            RETURN false;
        END IF;
        v_page := (loc ->> 'page')::bigint;
        IF v_page < 1 THEN
            RETURN false;
        END IF;

        IF loc ? 'page_end' AND jsonb_typeof(loc -> 'page_end') <> 'null' THEN
            IF jsonb_typeof(loc -> 'page_end') <> 'number' OR (loc ->> 'page_end') !~ '^[0-9]+$' THEN
                RETURN false;
            END IF;
            v_page_end := (loc ->> 'page_end')::bigint;
            IF v_page_end < v_page THEN
                RETURN false;
            END IF;
        END IF;

        RETURN true;

    ELSIF v_type = 'video_time' THEN
        -- Chỉ cho phép khóa: type, start_ms, end_ms
        IF NOT (loc - ARRAY['type', 'start_ms', 'end_ms'] = '{}'::jsonb) THEN
            RETURN false;
        END IF;

        IF jsonb_typeof(loc -> 'start_ms') <> 'number' OR jsonb_typeof(loc -> 'end_ms') <> 'number' THEN
            RETURN false;
        END IF;

        IF (loc ->> 'start_ms') !~ '^[0-9]+$' OR (loc ->> 'end_ms') !~ '^[0-9]+$' THEN
            RETURN false;
        END IF;

        v_start_ms := (loc ->> 'start_ms')::bigint;
        v_end_ms   := (loc ->> 'end_ms')::bigint;

        IF v_start_ms < 0 OR v_end_ms <= v_start_ms THEN
            RETURN false;
        END IF;

        RETURN true;
    ELSE
        RETURN false;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION app.is_valid_locator(jsonb) TO app_api, app_worker;

-- 9. Trigger chuẩn: cập nhật `updated_at`
CREATE OR REPLACE FUNCTION app.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- 10. Trigger đồng bộ đa thiết bị: kiểm soát `revision` + cấp `change_seq`
-- Quy tắc:
--   - INSERT: ép revision = 1, gán change_seq mới, created_at/updated_at = now()
--   - UPDATE: bắt buộc NEW.revision = OLD.revision + 1 (chặn ghi đè mù khi quên WHERE revision = expected)
CREATE OR REPLACE FUNCTION app.tg_sync_versioning()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.revision   := 1;
        NEW.change_seq := nextval('app.global_change_seq');
        NEW.created_at := COALESCE(NEW.created_at, now());
        NEW.updated_at := now();
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
            RAISE EXCEPTION 'REVISION_CONFLICT: expected revision % -> %, got % on table %.%',
                OLD.revision, OLD.revision + 1, NEW.revision, TG_TABLE_SCHEMA, TG_TABLE_NAME
                USING ERRCODE = '40001';
        END IF;
        NEW.change_seq := nextval('app.global_change_seq');
        NEW.created_at := OLD.created_at;
        NEW.updated_at := now();
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$;

-- 11. Trigger chặn đổi chủ sở hữu (`owner_id`) sau khi tạo
CREATE OR REPLACE FUNCTION app.tg_immutable_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
        RAISE EXCEPTION 'IMMUTABLE_COLUMN: owner_id cannot be changed on %.%',
            TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;



-- =============================================================================
-- MIGRATION: 002_users_access_quota.sql
-- =============================================================================

-- =============================================================================
-- Migration 002: Người dùng, Phân quyền (`user_access`), Hạn mức & Vận hành
-- Dự án: StudyFlow AI
-- Phụ thuộc: 001_foundation.sql
-- =============================================================================

BEGIN;

-- 1. Kiểu Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'user_role') THEN
        CREATE TYPE app.user_role AS ENUM ('learner', 'admin');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'account_status') THEN
        CREATE TYPE app.account_status AS ENUM ('active', 'suspended', 'pending_deletion');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'self_level') THEN
        CREATE TYPE app.self_level AS ENUM ('beginner', 'intermediate', 'advanced');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'explain_style') THEN
        CREATE TYPE app.explain_style AS ENUM ('easy', 'deep', 'concise', 'example');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'ui_theme') THEN
        CREATE TYPE app.ui_theme AS ENUM ('system', 'light', 'dark');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'ai_feature') THEN
        CREATE TYPE app.ai_feature AS ENUM (
            'chat', 'explain', 'summary', 'curriculum',
            'quiz_gen', 'flashcard_gen', 'outline_check', 'ingestion'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'ai_request_status') THEN
        CREATE TYPE app.ai_request_status AS ENUM ('reserved', 'running', 'committed', 'released', 'failed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'usage_call_kind') THEN
        CREATE TYPE app.usage_call_kind AS ENUM ('llm', 'embedding', 'stt', 'rerank');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'usage_status') THEN
        CREATE TYPE app.usage_status AS ENUM ('success', 'failed');
    END IF;
END
$$;

-- 2. Nếu chạy trên PostgreSQL độc lập (chưa có schema `auth` của Supabase),
-- tạo bảng giả lập tối thiểu `auth.users` để kiểm thử tự động hoạt động giống hệt Supabase.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
        CREATE SCHEMA auth;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'auth' AND c.relname = 'users'
    ) THEN
        CREATE TABLE auth.users (
            id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
            email text UNIQUE,
            raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        );
    END IF;
END
$$;

-- 3. Bảng `app.profiles` — chỉ chứa thông tin cá nhân người học được phép tự sửa
CREATE TABLE IF NOT EXISTS app.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 120),
    avatar_url text CHECK (avatar_url IS NULL OR avatar_url ~ '^https://'),
    field_of_study text CHECK (field_of_study IS NULL OR char_length(field_of_study) <= 120),
    education_level text CHECK (education_level IS NULL OR char_length(education_level) <= 80),
    interested_subjects text[] NOT NULL DEFAULT '{}'::text[],
    self_declared_level app.self_level,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tg_profiles_updated_at
BEFORE UPDATE ON app.profiles
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- 4. Bảng `app.user_access` — tách riêng role & status, người dùng KHÔNG tự sửa được
CREATE TABLE IF NOT EXISTS app.user_access (
    user_id uuid PRIMARY KEY REFERENCES app.profiles(id) ON DELETE CASCADE,
    role app.user_role NOT NULL DEFAULT 'learner',
    status app.account_status NOT NULL DEFAULT 'active',
    status_reason text,
    changed_by uuid REFERENCES app.profiles(id) ON DELETE SET NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tg_user_access_updated_at
BEFORE UPDATE ON app.user_access
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- 5. Bảng `app.user_preferences` — tùy chỉnh giao diện, cách AI giải thích & công cụ hiển thị
CREATE TABLE IF NOT EXISTS app.user_preferences (
    user_id uuid PRIMARY KEY REFERENCES app.profiles(id) ON DELETE CASCADE,
    ai_explain_style app.explain_style NOT NULL DEFAULT 'easy',
    allow_external_knowledge boolean NOT NULL DEFAULT false,
    ui_theme app.ui_theme NOT NULL DEFAULT 'system',
    font_scale numeric(3,2) NOT NULL DEFAULT 1.00 CHECK (font_scale >= 0.80 AND font_scale <= 2.00),
    locale text NOT NULL DEFAULT 'vi' CHECK (char_length(locale) BETWEEN 2 AND 10),
    timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh' CHECK (char_length(timezone) BETWEEN 1 AND 64),
    visible_tools jsonb NOT NULL DEFAULT '{
        "goals": false,
        "planner": false,
        "reminders": false,
        "flashcards": false,
        "focus_timer": false,
        "detailed_report": false
    }'::jsonb CHECK (
        jsonb_typeof(visible_tools) = 'object'
        AND (visible_tools - ARRAY['goals', 'planner', 'reminders', 'flashcards', 'focus_timer', 'detailed_report'] = '{}'::jsonb)
    ),
    quiet_hours_start time,
    quiet_hours_end time,
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tg_user_preferences_sync
BEFORE INSERT OR UPDATE ON app.user_preferences
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- 6. Bảng `app.storage_usage` — dung lượng lưu trữ (KHÔNG reset theo tháng)
CREATE TABLE IF NOT EXISTS app.storage_usage (
    user_id uuid PRIMARY KEY REFERENCES app.profiles(id) ON DELETE CASCADE,
    limit_bytes bigint NOT NULL DEFAULT 524288000 CHECK (limit_bytes > 0), -- 500 MB mặc định
    used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
    reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
    reconciled_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_storage_within_limit CHECK (used_bytes + reserved_bytes <= limit_bytes)
);

CREATE TRIGGER tg_storage_usage_updated_at
BEFORE UPDATE ON app.storage_usage
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- 7. Bảng `app.quota_periods` — hạn mức AI theo kỳ (composite PK: user_id + period_start)
CREATE TABLE IF NOT EXISTS app.quota_periods (
    user_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    period_start date NOT NULL,
    period_end date NOT NULL CHECK (period_end > period_start),
    ai_unit_limit integer NOT NULL DEFAULT 200 CHECK (ai_unit_limit >= 0),
    ai_unit_used integer NOT NULL DEFAULT 0 CHECK (ai_unit_used >= 0),
    ai_unit_reserved integer NOT NULL DEFAULT 0 CHECK (ai_unit_reserved >= 0),
    embedding_token_limit bigint NOT NULL DEFAULT 1000000 CHECK (embedding_token_limit >= 0),
    embedding_token_used bigint NOT NULL DEFAULT 0 CHECK (embedding_token_used >= 0),
    transcription_minutes_limit numeric(8,2) NOT NULL DEFAULT 120.00 CHECK (transcription_minutes_limit >= 0),
    transcription_minutes_used numeric(8,2) NOT NULL DEFAULT 0.00 CHECK (transcription_minutes_used >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, period_start),
    CONSTRAINT chk_ai_units_within_limit CHECK (ai_unit_used + ai_unit_reserved <= ai_unit_limit)
);

CREATE TRIGGER tg_quota_periods_updated_at
BEFORE UPDATE ON app.quota_periods
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- 8. Bảng `app.ai_requests` — yêu cầu AI tổng (1 hành động người dùng = 1 dòng, giữ chỗ quota)
CREATE TABLE IF NOT EXISTS app.ai_requests (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    period_start date NOT NULL,
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
    feature app.ai_feature NOT NULL,
    status app.ai_request_status NOT NULL DEFAULT 'reserved',
    reserved_units integer NOT NULL DEFAULT 1 CHECK (reserved_units >= 0),
    committed_units integer NOT NULL DEFAULT 0 CHECK (committed_units >= 0),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
    target_type text,
    target_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key),
    UNIQUE (id, user_id),
    FOREIGN KEY (user_id, period_start) REFERENCES app.quota_periods(user_id, period_start) ON DELETE RESTRICT
);

CREATE TRIGGER tg_ai_requests_updated_at
BEFORE UPDATE ON app.ai_requests
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- 9. Bảng `app.usage_events` — từng lần gọi model/embedding/STT bên trong một `ai_request`
CREATE TABLE IF NOT EXISTS app.usage_events (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    ai_request_id uuid NOT NULL,
    user_id uuid NOT NULL,
    call_seq integer NOT NULL CHECK (call_seq >= 1),
    call_kind app.usage_call_kind NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    provider_call_id text,
    input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    units numeric(12,4) NOT NULL DEFAULT 0 CHECK (units >= 0),
    latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
    status app.usage_status NOT NULL,
    estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
    price_version text NOT NULL DEFAULT 'v1',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ai_request_id, call_seq),
    FOREIGN KEY (ai_request_id, user_id) REFERENCES app.ai_requests(id, user_id) ON DELETE CASCADE
);

-- 10. Bảng `app.audit_logs` — chỉ ghi thêm (append-only), phục vụ kiểm toán
CREATE TABLE IF NOT EXISTS app.audit_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id uuid,
    actor_role text NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Chặn UPDATE / DELETE trên `audit_logs` kể cả từ hàm sai sót
CREATE OR REPLACE FUNCTION app.tg_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: audit_logs is append-only'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER tg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON app.audit_logs
FOR EACH ROW EXECUTE FUNCTION app.tg_audit_append_only();

-- 11. Bảng `app.app_settings` — cấu hình hệ thống
CREATE TABLE IF NOT EXISTS app.app_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_by uuid REFERENCES app.profiles(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 12. Hàm nhận diện người dùng đang hoạt động (`current_user_id`) & Admin (`is_admin`)
-- Trả về NULL ngay lập tức nếu tài khoản bị khóa (`suspended` / `pending_deletion`)!
-- =============================================================================

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE PARALLEL SAFE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
    SELECT ua.user_id
    FROM app.user_access ua
    WHERE ua.user_id = app.raw_user_id()
      AND ua.status = 'active';
$$;

CREATE OR REPLACE FUNCTION app.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE PARALLEL SAFE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM app.user_access ua
        WHERE ua.user_id = app.raw_user_id()
          AND ua.status = 'active'
          AND ua.role = 'admin'
    );
$$;

GRANT EXECUTE ON FUNCTION app.current_user_id() TO app_api, app_worker;
GRANT EXECUTE ON FUNCTION app.is_admin() TO app_api, app_worker;

-- =============================================================================
-- 13. Hàm khởi tạo hồ sơ khi người dùng đăng ký + Hàm quản trị đổi quyền/trạng thái
-- =============================================================================

CREATE OR REPLACE FUNCTION app.provision_user_records(
    p_user_id uuid,
    p_display_name text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_month_start date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
    v_month_end   date := (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month')::date;
BEGIN
    INSERT INTO app.profiles (id, display_name)
    VALUES (p_user_id, COALESCE(p_display_name, ''))
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO app.user_access (user_id, role, status)
    VALUES (p_user_id, 'learner', 'active')
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO app.user_preferences (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO app.storage_usage (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO app.quota_periods (user_id, period_start, period_end)
    VALUES (p_user_id, v_month_start, v_month_end)
    ON CONFLICT (user_id, period_start) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION app.tg_on_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
    PERFORM app.provision_user_records(
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(COALESCE(NEW.email, ''), '@', 1))
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION app.tg_on_auth_user_created();

-- Hàm chỉ dành cho Admin để đổi role hoặc khóa/mở tài khoản, tự động ghi audit_logs
CREATE OR REPLACE FUNCTION app.admin_set_user_access(
    p_target_user_id uuid,
    p_new_role app.user_role,
    p_new_status app.account_status,
    p_reason text DEFAULT NULL
)
RETURNS app.user_access
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_actor_id uuid := app.current_user_id();
    v_old app.user_access;
    v_new app.user_access;
BEGIN
    IF NOT app.is_admin() THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: only active admin can modify user_access'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_old
    FROM app.user_access
    WHERE user_id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: user_access for % does not exist', p_target_user_id
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE app.user_access
    SET role          = COALESCE(p_new_role, role),
        status        = COALESCE(p_new_status, status),
        status_reason = p_reason,
        changed_by    = v_actor_id,
        changed_at    = now()
    WHERE user_id = p_target_user_id
    RETURNING * INTO v_new;

    INSERT INTO app.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
    VALUES (
        v_actor_id,
        'admin',
        'user_access.updated',
        'user_access',
        p_target_user_id::text,
        jsonb_build_object(
            'old_role', v_old.role,
            'new_role', v_new.role,
            'old_status', v_old.status,
            'new_status', v_new.status,
            'reason', p_reason
        )
    );

    RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION app.admin_set_user_access(uuid, app.user_role, app.account_status, text) TO app_api;

-- =============================================================================
-- 14. Hàm Giữ chỗ & Đối soát Quota nguyên tử (chống vượt quota khi gọi đồng thời)
-- =============================================================================

CREATE OR REPLACE FUNCTION app.reserve_ai_quota(
    p_idempotency_key text,
    p_feature app.ai_feature,
    p_units integer DEFAULT 1,
    p_target_type text DEFAULT NULL,
    p_target_id uuid DEFAULT NULL
)
RETURNS app.ai_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_uid uuid := app.current_user_id();
    v_period_start date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
    v_period_end   date := (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month')::date;
    v_existing app.ai_requests;
    v_quota app.quota_periods;
    v_req app.ai_requests;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: active user required'
            USING ERRCODE = '42501';
    END IF;

    IF p_units < 0 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_units must be >= 0'
            USING ERRCODE = '22023';
    END IF;

    -- Đảm bảo kỳ hiện tại tồn tại và khóa hàng FOR UPDATE để tuần tự hóa yêu cầu đồng thời
    INSERT INTO app.quota_periods (user_id, period_start, period_end)
    VALUES (v_uid, v_period_start, v_period_end)
    ON CONFLICT (user_id, period_start) DO NOTHING;

    SELECT * INTO v_quota
    FROM app.quota_periods
    WHERE user_id = v_uid AND period_start = v_period_start
    FOR UPDATE;

    -- Kiểm tra idempotency sau khi đã giữ khóa user_id
    SELECT * INTO v_existing
    FROM app.ai_requests
    WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        RETURN v_existing;
    END IF;

    IF v_quota.ai_unit_used + v_quota.ai_unit_reserved + p_units > v_quota.ai_unit_limit THEN
        RAISE EXCEPTION 'QUOTA_EXCEEDED: limit=%, used=%, reserved=%, requested=%',
            v_quota.ai_unit_limit, v_quota.ai_unit_used, v_quota.ai_unit_reserved, p_units
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE app.quota_periods
    SET ai_unit_reserved = ai_unit_reserved + p_units
    WHERE user_id = v_uid AND period_start = v_period_start;

    INSERT INTO app.ai_requests (
        user_id, period_start, idempotency_key, feature, status,
        reserved_units, committed_units, target_type, target_id
    )
    VALUES (
        v_uid, v_period_start, p_idempotency_key, p_feature, 'reserved',
        p_units, 0, p_target_type, p_target_id
    )
    RETURNING * INTO v_req;

    RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION app.settle_ai_quota(
    p_request_id uuid,
    p_commit boolean,
    p_actual_units integer DEFAULT NULL
)
RETURNS app.ai_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
    v_uid uuid := app.current_user_id();
    v_req app.ai_requests;
    v_commit_units integer;
BEGIN
    SELECT * INTO v_req
    FROM app.ai_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: ai_request % not found', p_request_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Cho phép chủ sở hữu hoặc worker đang chạy dưới quyền chủ sở hữu
    IF v_req.user_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: cannot settle another user request'
            USING ERRCODE = '42501';
    END IF;

    -- Idempotent: nếu đã kết thúc thì trả về luôn
    IF v_req.status IN ('committed', 'released', 'failed') THEN
        RETURN v_req;
    END IF;

    IF p_commit THEN
        v_commit_units := LEAST(COALESCE(p_actual_units, v_req.reserved_units), v_req.reserved_units);

        UPDATE app.quota_periods
        SET ai_unit_reserved = ai_unit_reserved - v_req.reserved_units,
            ai_unit_used     = ai_unit_used + v_commit_units
        WHERE user_id = v_req.user_id AND period_start = v_req.period_start;

        UPDATE app.ai_requests
        SET status          = 'committed',
            committed_units = v_commit_units
        WHERE id = p_request_id
        RETURNING * INTO v_req;
    ELSE
        UPDATE app.quota_periods
        SET ai_unit_reserved = ai_unit_reserved - v_req.reserved_units
        WHERE user_id = v_req.user_id AND period_start = v_req.period_start;

        UPDATE app.ai_requests
        SET status          = 'released',
            committed_units = 0
        WHERE id = p_request_id
        RETURNING * INTO v_req;
    END IF;

    RETURN v_req;
END;
$$;

GRANT EXECUTE ON FUNCTION app.reserve_ai_quota(text, app.ai_feature, integer, text, uuid) TO app_api, app_worker;
GRANT EXECUTE ON FUNCTION app.settle_ai_quota(uuid, boolean, integer) TO app_api, app_worker;

-- =============================================================================
-- 15. Bật RLS + FORCE RLS & Phân quyền cột/bảng chi tiết
-- =============================================================================

ALTER TABLE app.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.profiles         FORCE ROW LEVEL SECURITY;

ALTER TABLE app.user_access      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_access      FORCE ROW LEVEL SECURITY;

ALTER TABLE app.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_preferences FORCE ROW LEVEL SECURITY;

ALTER TABLE app.storage_usage    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.storage_usage    FORCE ROW LEVEL SECURITY;

ALTER TABLE app.quota_periods    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quota_periods    FORCE ROW LEVEL SECURITY;

ALTER TABLE app.ai_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_requests      FORCE ROW LEVEL SECURITY;

ALTER TABLE app.usage_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usage_events     FORCE ROW LEVEL SECURITY;

ALTER TABLE app.audit_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_logs       FORCE ROW LEVEL SECURITY;

ALTER TABLE app.app_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.app_settings     FORCE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY pol_profiles_own ON app.profiles
    FOR ALL TO app_api, app_worker
    USING (id = app.current_user_id())
    WITH CHECK (id = app.current_user_id());

-- Đặc biệt: `user_access` cho phép đọc dòng của chính mình kể cả khi bị `suspended`
-- (qua `app.raw_user_id()`) để endpoint `GET /me/access` hiển thị lý do bị khóa,
-- nhưng KHÔNG có policy UPDATE/INSERT cho người thường!
CREATE POLICY pol_user_access_read_self ON app.user_access
    FOR SELECT TO app_api, app_worker
    USING (user_id = app.raw_user_id() OR app.is_admin());

CREATE POLICY pol_user_preferences_own ON app.user_preferences
    FOR ALL TO app_api, app_worker
    USING (user_id = app.current_user_id())
    WITH CHECK (user_id = app.current_user_id());

CREATE POLICY pol_storage_usage_read ON app.storage_usage
    FOR SELECT TO app_api, app_worker
    USING (user_id = app.current_user_id() OR app.is_admin());

CREATE POLICY pol_quota_periods_read ON app.quota_periods
    FOR SELECT TO app_api, app_worker
    USING (user_id = app.current_user_id() OR app.is_admin());

CREATE POLICY pol_ai_requests_read ON app.ai_requests
    FOR SELECT TO app_api, app_worker
    USING (user_id = app.current_user_id() OR app.is_admin());

CREATE POLICY pol_usage_events_own ON app.usage_events
    FOR SELECT TO app_api, app_worker
    USING (user_id = app.current_user_id() OR app.is_admin());

CREATE POLICY pol_usage_events_insert ON app.usage_events
    FOR INSERT TO app_api, app_worker
    WITH CHECK (user_id = app.current_user_id());

CREATE POLICY pol_audit_logs_admin_read ON app.audit_logs
    FOR SELECT TO app_api
    USING (app.is_admin());

CREATE POLICY pol_audit_logs_insert ON app.audit_logs
    FOR INSERT TO app_api, app_worker
    WITH CHECK (actor_id = app.current_user_id());

CREATE POLICY pol_app_settings_read ON app.app_settings
    FOR SELECT TO app_api, app_worker
    USING (app.current_user_id() IS NOT NULL);

CREATE POLICY pol_app_settings_admin_write ON app.app_settings
    FOR ALL TO app_api
    USING (app.is_admin())
    WITH CHECK (app.is_admin());

-- Grants theo cột/bảng:
-- 1) `profiles`: chỉ cho UPDATE các cột hồ sơ, không cho đổi `id` hay `created_at`
GRANT SELECT ON app.profiles TO app_api, app_worker;
GRANT UPDATE (display_name, avatar_url, field_of_study, education_level, interested_subjects, self_declared_level)
    ON app.profiles TO app_api;

-- 2) `user_access`: chỉ cho SELECT (đổi quyền/trạng thái bắt buộc đi qua `app.admin_set_user_access`)
GRANT SELECT ON app.user_access TO app_api, app_worker;

-- 3) `user_preferences`: cho phép đọc và sửa các cột tùy chọn + `revision`
GRANT SELECT ON app.user_preferences TO app_api, app_worker;
GRANT UPDATE (
    ai_explain_style, allow_external_knowledge, ui_theme, font_scale,
    locale, timezone, visible_tools, quiet_hours_start, quiet_hours_end, revision
) ON app.user_preferences TO app_api;

-- 4) `storage_usage`, `quota_periods`, `ai_requests`: chỉ SELECT (mọi thay đổi đi qua hàm giữ chỗ/đối soát)
GRANT SELECT ON app.storage_usage, app.quota_periods, app.ai_requests TO app_api, app_worker;

-- 5) `usage_events`, `audit_logs`, `app_settings`
GRANT SELECT, INSERT ON app.usage_events TO app_api, app_worker;
GRANT SELECT, INSERT ON app.audit_logs TO app_api, app_worker;
GRANT SELECT ON app.app_settings TO app_api, app_worker;
GRANT INSERT, UPDATE, DELETE ON app.app_settings TO app_api;

COMMIT;



-- =============================================================================
-- MIGRATION: 003_sources_and_jobs.sql
-- =============================================================================

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



-- =============================================================================
-- MIGRATION: 004_ai_tutor_and_notes.sql
-- =============================================================================

-- =============================================================================
-- Migration 004: Trợ giảng AI (`conversations`, `messages`, `message_citations`,
--                `retrieval_logs`), Ghi chú (`notes`) & Báo lỗi (`content_feedback`)
-- Dự án: StudyFlow AI
-- Phụ thuộc: 001..003
-- =============================================================================

BEGIN;

-- 1. Kiểu Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'conversation_scope') THEN
        CREATE TYPE app.conversation_scope AS ENUM ('single_source', 'multi_source', 'course', 'lesson');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'message_role') THEN
        CREATE TYPE app.message_role AS ENUM ('user', 'assistant');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'message_intent') THEN
        CREATE TYPE app.message_intent AS ENUM (
            'ask', 'explain_selection', 'summarize', 'glossary',
            'compare', 'example', 'step_hint', 'self_explain_feedback'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'message_status') THEN
        CREATE TYPE app.message_status AS ENUM ('pending', 'streaming', 'completed', 'failed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'source_sufficiency') THEN
        CREATE TYPE app.source_sufficiency AS ENUM ('sufficient', 'partial', 'insufficient', 'conflicting');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'assessed_by') THEN
        CREATE TYPE app.assessed_by AS ENUM ('ai', 'backend_rule', 'reviewer');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'citation_validation') THEN
        CREATE TYPE app.citation_validation AS ENUM ('pending', 'valid', 'invalid');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'citation_support') THEN
        CREATE TYPE app.citation_support AS ENUM ('unchecked', 'supported', 'partial', 'unsupported');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'retrieval_method') THEN
        CREATE TYPE app.retrieval_method AS ENUM ('vector', 'keyword', 'hybrid');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'note_kind') THEN
        CREATE TYPE app.note_kind AS ENUM ('note', 'highlight', 'question', 'saved_answer');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'question_note_status') THEN
        CREATE TYPE app.question_note_status AS ENUM ('open', 'resolved');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'feedback_target') THEN
        CREATE TYPE app.feedback_target AS ENUM ('message', 'citation', 'question', 'curriculum_draft', 'flashcard');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'feedback_category') THEN
        CREATE TYPE app.feedback_category AS ENUM ('wrong_info', 'wrong_citation', 'ambiguous', 'wrong_answer_key', 'other');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'feedback_status') THEN
        CREATE TYPE app.feedback_status AS ENUM ('open', 'in_review', 'resolved', 'rejected');
    END IF;
END
$$;

-- 2. Bảng `app.conversations` — Hội thoại tồn tại độc lập hoặc gắn với khóa/bài học
CREATE TABLE IF NOT EXISTS app.conversations (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    title text NOT NULL DEFAULT 'Cuộc trò chuyện mới' CHECK (char_length(btrim(title)) BETWEEN 1 AND 250),
    scope_type app.conversation_scope NOT NULL DEFAULT 'single_source',
    course_id uuid,
    lesson_id uuid,
    explain_style app.explain_style,
    last_message_at timestamptz NOT NULL DEFAULT now(),
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    CONSTRAINT chk_conversation_scope_targets CHECK (
        (scope_type = 'lesson' AND lesson_id IS NOT NULL AND course_id IS NOT NULL)
        OR (scope_type = 'course' AND course_id IS NOT NULL AND lesson_id IS NULL)
        OR (scope_type IN ('single_source', 'multi_source') AND lesson_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_conversations_owner_recent
    ON app.conversations(owner_id, last_message_at DESC)
    WHERE deleted_at IS NULL;

CREATE TRIGGER tg_conversations_immutable_owner
BEFORE UPDATE ON app.conversations
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_conversations_sync
BEFORE INSERT OR UPDATE ON app.conversations
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- 3. Bảng `app.conversation_sources` — Phạm vi nguồn của hội thoại (Khóa ngoại ghép)
CREATE TABLE IF NOT EXISTS app.conversation_sources (
    conversation_id uuid NOT NULL,
    source_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, source_id),
    FOREIGN KEY (conversation_id, owner_id) REFERENCES app.conversations(id, owner_id) ON DELETE CASCADE,
    FOREIGN KEY (source_id, owner_id) REFERENCES app.sources(id, owner_id) ON DELETE CASCADE
);

CREATE TRIGGER tg_conversation_sources_immutable_owner
BEFORE UPDATE ON app.conversation_sources
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

-- 4. Bảng `app.messages` — Tin nhắn trong hội thoại
CREATE TABLE IF NOT EXISTS app.messages (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    conversation_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    role app.message_role NOT NULL,
    intent app.message_intent NOT NULL DEFAULT 'ask',
    content text NOT NULL,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    status app.message_status NOT NULL DEFAULT 'completed',
    source_sufficiency app.source_sufficiency,
    sufficiency_assessed_by app.assessed_by,
    uses_external_knowledge boolean NOT NULL DEFAULT false,
    model text,
    prompt_version text,
    ai_request_id uuid,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    UNIQUE (id, conversation_id, owner_id),
    CONSTRAINT chk_messages_sufficiency_assessor CHECK (
        (source_sufficiency IS NULL AND sufficiency_assessed_by IS NULL)
        OR (source_sufficiency IS NOT NULL AND sufficiency_assessed_by IS NOT NULL)
    ),
    FOREIGN KEY (conversation_id, owner_id) REFERENCES app.conversations(id, owner_id) ON DELETE CASCADE,
    FOREIGN KEY (ai_request_id, owner_id) REFERENCES app.ai_requests(id, user_id) ON DELETE SET NULL (ai_request_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON app.messages(conversation_id, created_at ASC);

CREATE TRIGGER tg_messages_immutable_owner
BEFORE UPDATE ON app.messages
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_messages_updated_at
BEFORE UPDATE ON app.messages
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- 5. Bảng `app.message_citations` — Trích dẫn gắn với `chunk_id`, `source_version_id` và `locator_snapshot`
CREATE TABLE IF NOT EXISTS app.message_citations (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    message_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal >= 1),
    chunk_id uuid,
    source_id uuid,
    source_version_id uuid,
    locator_snapshot jsonb NOT NULL CHECK (app.is_valid_locator(locator_snapshot)),
    quote text,
    validation_status app.citation_validation NOT NULL DEFAULT 'pending',
    support_status app.citation_support NOT NULL DEFAULT 'unchecked',
    support_assessed_by app.assessed_by,
    support_checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (message_id, ordinal),
    CONSTRAINT chk_citation_support_assessor CHECK (
        (support_status = 'unchecked' AND support_assessed_by IS NULL)
        OR (support_status <> 'unchecked' AND support_assessed_by IS NOT NULL)
    ),
    CONSTRAINT chk_citation_source_version_pair CHECK (
        (source_version_id IS NULL AND source_id IS NULL AND chunk_id IS NULL)
        OR (source_version_id IS NOT NULL AND source_id IS NOT NULL)
    ),
    FOREIGN KEY (message_id, owner_id)
        REFERENCES app.messages(id, owner_id) ON DELETE CASCADE,
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE SET NULL (source_version_id, source_id),
    FOREIGN KEY (chunk_id, source_version_id, owner_id)
        REFERENCES app.source_chunks(id, source_version_id, owner_id)
        ON DELETE SET NULL (chunk_id)
);

-- Trigger bảo đảm citation được đánh dấu `valid` phải có `chunk_id` tồn tại
-- và thuộc đúng nguồn nằm trong phạm vi hội thoại (`conversation_sources`)
CREATE OR REPLACE FUNCTION app.tg_validate_citation_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, pg_temp
AS $$
DECLARE
    v_conv_id uuid;
    v_in_scope boolean;
BEGIN
    IF NEW.validation_status = 'valid' THEN
        IF NEW.chunk_id IS NULL OR NEW.source_id IS NULL OR NEW.source_version_id IS NULL THEN
            RAISE EXCEPTION 'INVALID_CITATION: valid citation must have chunk_id, source_id, and source_version_id'
                USING ERRCODE = '22023';
        END IF;

        SELECT m.conversation_id INTO v_conv_id
        FROM app.messages m
        WHERE m.id = NEW.message_id AND m.owner_id = NEW.owner_id;

        SELECT EXISTS (
            SELECT 1
            FROM app.conversation_sources cs
            WHERE cs.conversation_id = v_conv_id
              AND cs.source_id = NEW.source_id
              AND cs.owner_id = NEW.owner_id
        ) INTO v_in_scope;

        IF NOT v_in_scope THEN
            RAISE EXCEPTION 'CITATION_OUT_OF_SCOPE: source % is not in conversation % scope',
                NEW.source_id, v_conv_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_message_citations_scope
BEFORE INSERT OR UPDATE ON app.message_citations
FOR EACH ROW EXECUTE FUNCTION app.tg_validate_citation_scope();

-- 6. Bảng `app.retrieval_logs` — Nhật ký truy xuất phục vụ đánh giá thực nghiệm RAG
CREATE TABLE IF NOT EXISTS app.retrieval_logs (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    message_id uuid NOT NULL UNIQUE,
    owner_id uuid NOT NULL,
    method app.retrieval_method NOT NULL,
    embedding_model_id uuid,
    top_k integer NOT NULL CHECK (top_k > 0 AND top_k <= 100),
    candidate_chunk_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    selected_chunk_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    scores real[] NOT NULL DEFAULT '{}'::real[],
    rejected_source_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    latency_ms integer NOT NULL CHECK (latency_ms >= 0),
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (message_id, owner_id) REFERENCES app.messages(id, owner_id) ON DELETE CASCADE
);

-- 7. Bảng `app.notes` — Gộp 4 loại (note, highlight, question, saved_answer) + Ràng buộc theo `kind`
CREATE TABLE IF NOT EXISTS app.notes (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    kind app.note_kind NOT NULL DEFAULT 'note',
    title text CHECK (title IS NULL OR char_length(title) <= 250),
    body text CHECK (body IS NULL OR char_length(body) <= 20000),
    quote text CHECK (quote IS NULL OR char_length(quote) <= 5000),
    source_id uuid,
    source_version_id uuid,
    locator jsonb CHECK (app.is_valid_locator(locator)),
    course_id uuid,
    lesson_id uuid,
    message_id uuid,
    status app.question_note_status,
    resolved_at timestamptz,
    client_updated_at timestamptz,
    revision integer NOT NULL DEFAULT 1,
    change_seq bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id),
    -- Ràng buộc cặp cột nguồn & vị trí: có locator bắt buộc có source_version_id + source_id
    CONSTRAINT chk_notes_source_version_pair CHECK (
        (locator IS NULL OR source_version_id IS NOT NULL)
        AND (
            (source_version_id IS NULL AND source_id IS NULL)
            OR (source_version_id IS NOT NULL AND source_id IS NOT NULL)
        )
    ),
    -- Ràng buộc theo từng loại `kind`
    CONSTRAINT chk_notes_by_kind CHECK (
        (kind = 'note' AND body IS NOT NULL AND char_length(btrim(body)) > 0 AND status IS NULL AND resolved_at IS NULL)
        OR (kind = 'highlight' AND quote IS NOT NULL AND char_length(btrim(quote)) > 0 AND source_version_id IS NOT NULL AND locator IS NOT NULL AND status IS NULL AND resolved_at IS NULL)
        OR (kind = 'saved_answer' AND message_id IS NOT NULL AND status IS NULL AND resolved_at IS NULL)
        OR (
            kind = 'question'
            AND body IS NOT NULL AND char_length(btrim(body)) > 0
            AND status IS NOT NULL
            AND ((status = 'resolved' AND resolved_at IS NOT NULL) OR (status = 'open' AND resolved_at IS NULL))
        )
    ),
    FOREIGN KEY (source_version_id, source_id, owner_id)
        REFERENCES app.source_versions(id, source_id, owner_id)
        ON DELETE SET NULL (source_version_id, source_id),
    FOREIGN KEY (message_id, owner_id)
        REFERENCES app.messages(id, owner_id)
        ON DELETE SET NULL (message_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_owner_active
    ON app.notes(owner_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notes_source
    ON app.notes(owner_id, source_id, source_version_id)
    WHERE deleted_at IS NULL AND source_id IS NOT NULL;

CREATE TRIGGER tg_notes_immutable_owner
BEFORE UPDATE ON app.notes
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

CREATE TRIGGER tg_notes_locator_bounds
BEFORE INSERT OR UPDATE ON app.notes
FOR EACH ROW EXECUTE FUNCTION app.tg_validate_locator_against_version();

CREATE TRIGGER tg_notes_sync
BEFORE INSERT OR UPDATE ON app.notes
FOR EACH ROW EXECUTE FUNCTION app.tg_sync_versioning();

-- 8. Bảng `app.content_feedback` — Báo lỗi phản hồi AI / trích dẫn / câu hỏi
CREATE TABLE IF NOT EXISTS app.content_feedback (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    reporter_id uuid NOT NULL REFERENCES app.profiles(id) ON DELETE CASCADE,
    target_type app.feedback_target NOT NULL,
    target_id uuid NOT NULL,
    category app.feedback_category NOT NULL,
    comment text CHECK (comment IS NULL OR char_length(comment) <= 2000),
    status app.feedback_status NOT NULL DEFAULT 'open',
    admin_note text,
    handled_by uuid REFERENCES app.profiles(id) ON DELETE SET NULL,
    handled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tg_content_feedback_updated_at
BEFORE UPDATE ON app.content_feedback
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- =============================================================================
-- 9. RLS & Phân quyền bảng/cột
-- =============================================================================

ALTER TABLE app.conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.conversations        FORCE ROW LEVEL SECURITY;

ALTER TABLE app.conversation_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.conversation_sources FORCE ROW LEVEL SECURITY;

ALTER TABLE app.messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.messages             FORCE ROW LEVEL SECURITY;

ALTER TABLE app.message_citations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.message_citations    FORCE ROW LEVEL SECURITY;

ALTER TABLE app.retrieval_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.retrieval_logs       FORCE ROW LEVEL SECURITY;

ALTER TABLE app.notes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notes                FORCE ROW LEVEL SECURITY;

ALTER TABLE app.content_feedback     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.content_feedback     FORCE ROW LEVEL SECURITY;

CREATE POLICY pol_conversations_own ON app.conversations
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_conversation_sources_own ON app.conversation_sources
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_messages_own ON app.messages
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_message_citations_own ON app.message_citations
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_retrieval_logs_own ON app.retrieval_logs
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id() OR app.is_admin())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_notes_own ON app.notes
    FOR ALL TO app_api, app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY pol_content_feedback_read ON app.content_feedback
    FOR SELECT TO app_api
    USING (reporter_id = app.current_user_id() OR app.is_admin());

CREATE POLICY pol_content_feedback_insert ON app.content_feedback
    FOR INSERT TO app_api
    WITH CHECK (reporter_id = app.current_user_id());

CREATE POLICY pol_content_feedback_admin_update ON app.content_feedback
    FOR UPDATE TO app_api
    USING (app.is_admin())
    WITH CHECK (app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.conversations, app.conversation_sources, app.notes TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.messages, app.message_citations, app.retrieval_logs TO app_api, app_worker;
GRANT SELECT, INSERT ON app.content_feedback TO app_api;
GRANT UPDATE (status, admin_note, handled_by, handled_at) ON app.content_feedback TO app_api;

COMMIT;



-- =============================================================================
-- MIGRATION: 005_courses_and_curriculum.sql
-- =============================================================================

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



-- =============================================================================
-- MIGRATION: 006_embeddings_and_retrieval.sql
-- =============================================================================

-- =============================================================================
-- Migration 006: Danh mục Mô hình Embedding động (`embedding_models`),
--                Bảng Vector (`chunk_embeddings`) & Hàm Truy xuất RAG (`match_chunks`)
-- Dự án: StudyFlow AI
-- Phụ thuộc: 001..005
-- Thiết kế: Không cố định số chiều vector trong schema; kiểm tra khớp chiều bằng trigger.
-- =============================================================================

BEGIN;

-- 1. Kiểu Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'vector_distance') THEN
        CREATE TYPE app.vector_distance AS ENUM ('cosine', 'inner_product');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typname = 'model_lifecycle') THEN
        CREATE TYPE app.model_lifecycle AS ENUM ('experimental', 'active', 'retired');
    END IF;
END
$$;

-- 2. Bảng `app.embedding_models` — Quản lý các mô hình embedding & số chiều
CREATE TABLE IF NOT EXISTS app.embedding_models (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    provider text NOT NULL CHECK (char_length(btrim(provider)) BETWEEN 1 AND 80),
    model_name text NOT NULL CHECK (char_length(btrim(model_name)) BETWEEN 1 AND 120),
    dimensions integer NOT NULL CHECK (dimensions BETWEEN 64 AND 2000),
    distance app.vector_distance NOT NULL DEFAULT 'cosine',
    status app.model_lifecycle NOT NULL DEFAULT 'experimental',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, model_name, dimensions)
);

-- Chỉ cho phép tối đa 1 mô hình ở trạng thái `active` tại một thời điểm
CREATE UNIQUE INDEX IF NOT EXISTS uq_embedding_models_single_active
    ON app.embedding_models((status))
    WHERE status = 'active';

CREATE TRIGGER tg_embedding_models_updated_at
BEFORE UPDATE ON app.embedding_models
FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at();

-- Bổ sung FK từ `retrieval_logs.embedding_model_id` sang `embedding_models`
ALTER TABLE app.retrieval_logs
    DROP CONSTRAINT IF EXISTS fk_retrieval_logs_embedding_model;

ALTER TABLE app.retrieval_logs
    ADD CONSTRAINT fk_retrieval_logs_embedding_model
    FOREIGN KEY (embedding_model_id)
    REFERENCES app.embedding_models(id)
    ON DELETE SET NULL;

-- 3. Bảng `app.chunk_embeddings` — Cột `embedding` kiểu `extensions.vector` (không khóa số chiều cứng)
CREATE TABLE IF NOT EXISTS app.chunk_embeddings (
    chunk_id uuid NOT NULL,
    embedding_model_id uuid NOT NULL REFERENCES app.embedding_models(id) ON DELETE RESTRICT,
    source_version_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    embedding extensions.vector NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chunk_id, embedding_model_id),
    FOREIGN KEY (chunk_id, source_version_id, owner_id)
        REFERENCES app.source_chunks(id, source_version_id, owner_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_version_model
    ON app.chunk_embeddings(source_version_id, embedding_model_id);

CREATE TRIGGER tg_chunk_embeddings_immutable_owner
BEFORE UPDATE ON app.chunk_embeddings
FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_owner();

-- Trigger bảo đảm số chiều của vector được chèn khớp chính xác với `embedding_models.dimensions`
CREATE OR REPLACE FUNCTION app.tg_check_embedding_dimensions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, extensions, pg_temp
AS $$
DECLARE
    v_expected_dims integer;
    v_actual_dims integer;
BEGIN
    SELECT dimensions INTO v_expected_dims
    FROM app.embedding_models
    WHERE id = NEW.embedding_model_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MODEL_NOT_FOUND: embedding_model_id % does not exist', NEW.embedding_model_id
            USING ERRCODE = 'P0002';
    END IF;

    v_actual_dims := extensions.vector_dims(NEW.embedding);
    IF v_actual_dims IS DISTINCT FROM v_expected_dims THEN
        RAISE EXCEPTION 'DIMENSION_MISMATCH: expected % dimensions for model %, got %',
            v_expected_dims, NEW.embedding_model_id, v_actual_dims
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_chunk_embeddings_dims
BEFORE INSERT OR UPDATE ON app.chunk_embeddings
FOR EACH ROW EXECUTE FUNCTION app.tg_check_embedding_dimensions();

-- =============================================================================
-- 4. Hàm truy xuất an toàn `app.match_chunks`
-- Bảo đảm:
--   - Chạy với `SECURITY INVOKER` (tôn trọng toàn bộ RLS).
--   - KHÔNG tin `p_requested_source_ids` từ client: tự động giao (intersect) với
--     các nguồn có `owner_id = app.current_user_id()`, `deleted_at IS NULL`, `status = 'ready'`.
--   - Chỉ truy xuất chunk thuộc `sources.active_version_id`!
--   - Hỗ trợ 3 chế độ: `keyword`, `vector`, `hybrid` (Reciprocal Rank Fusion - RRF).
-- =============================================================================

CREATE OR REPLACE FUNCTION app.match_chunks(
    p_requested_source_ids uuid[],
    p_query_text text DEFAULT NULL,
    p_query_embedding extensions.vector DEFAULT NULL,
    p_embedding_model_id uuid DEFAULT NULL,
    p_method app.retrieval_method DEFAULT 'hybrid',
    p_match_count integer DEFAULT 8,
    p_rrf_k integer DEFAULT 60
)
RETURNS TABLE (
    chunk_id uuid,
    source_id uuid,
    source_version_id uuid,
    chunk_index integer,
    heading text,
    content text,
    locator jsonb,
    vector_score real,
    keyword_score real,
    combined_score real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = app, extensions, pg_temp
AS $$
DECLARE
    v_uid uuid := app.current_user_id();
    v_limit integer := LEAST(GREATEST(COALESCE(p_match_count, 8), 1), 50);
    v_candidate_pool integer := v_limit * 4;
    v_tsquery tsquery;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: active user required for match_chunks'
            USING ERRCODE = '42501';
    END IF;

    IF p_requested_source_ids IS NULL OR cardinality(p_requested_source_ids) = 0 THEN
        RETURN;
    END IF;

    IF p_method IN ('vector', 'hybrid') AND (p_query_embedding IS NULL OR p_embedding_model_id IS NULL) THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_query_embedding and p_embedding_model_id required for % search', p_method
            USING ERRCODE = '22023';
    END IF;

    IF p_query_text IS NOT NULL AND char_length(btrim(p_query_text)) > 0 THEN
        v_tsquery := websearch_to_tsquery('simple', app.immutable_unaccent(p_query_text));
    END IF;

    RETURN QUERY
    WITH allowed_sources AS (
        -- Chỉ lấy nguồn thuộc chủ sở hữu hiện tại, chưa xóa mềm, đã ready và có active_version_id
        SELECT s.id AS source_id, s.active_version_id
        FROM app.sources s
        WHERE s.id = ANY(p_requested_source_ids)
          AND s.owner_id = v_uid
          AND s.deleted_at IS NULL
          AND s.status = 'ready'
          AND s.active_version_id IS NOT NULL
    ),
    eligible_chunks AS (
        SELECT
            sc.id,
            sc.source_id,
            sc.source_version_id,
            sc.chunk_index,
            sc.heading,
            sc.content,
            sc.locator,
            sc.fts
        FROM app.source_chunks sc
        JOIN allowed_sources a
          ON sc.source_id = a.source_id
         AND sc.source_version_id = a.active_version_id
        WHERE sc.owner_id = v_uid
    ),
    vec_ranked AS (
        SELECT
            ec.id AS cid,
            (1.0 - (ce.embedding <=> p_query_embedding))::real AS v_score,
            row_number() OVER (ORDER BY (ce.embedding <=> p_query_embedding) ASC, ec.chunk_index ASC) AS v_rank
        FROM eligible_chunks ec
        JOIN app.chunk_embeddings ce
          ON ce.chunk_id = ec.id
         AND ce.source_version_id = ec.source_version_id
         AND ce.owner_id = v_uid
        WHERE p_method IN ('vector', 'hybrid')
          AND ce.embedding_model_id = p_embedding_model_id
        ORDER BY (ce.embedding <=> p_query_embedding) ASC
        LIMIT v_candidate_pool
    ),
    kw_ranked AS (
        SELECT
            ec.id AS cid,
            ts_rank_cd(ec.fts, v_tsquery)::real AS k_score,
            row_number() OVER (ORDER BY ts_rank_cd(ec.fts, v_tsquery) DESC, ec.chunk_index ASC) AS k_rank
        FROM eligible_chunks ec
        WHERE p_method IN ('keyword', 'hybrid')
          AND v_tsquery IS NOT NULL
          AND ec.fts @@ v_tsquery
        ORDER BY ts_rank_cd(ec.fts, v_tsquery) DESC
        LIMIT v_candidate_pool
    ),
    fused AS (
        SELECT
            COALESCE(vr.cid, kr.cid) AS cid,
            vr.v_score,
            kr.k_score,
            CASE
                WHEN p_method = 'vector' THEN COALESCE(vr.v_score, 0.0)::real
                WHEN p_method = 'keyword' THEN COALESCE(kr.k_score, 0.0)::real
                ELSE (
                    COALESCE(1.0 / (p_rrf_k + vr.v_rank), 0.0)
                    + COALESCE(1.0 / (p_rrf_k + kr.k_rank), 0.0)
                )::real
            END AS c_score
        FROM vec_ranked vr
        FULL OUTER JOIN kw_ranked kr ON vr.cid = kr.cid
        WHERE (p_method = 'vector' AND vr.cid IS NOT NULL)
           OR (p_method = 'keyword' AND kr.cid IS NOT NULL)
           OR (p_method = 'hybrid' AND (vr.cid IS NOT NULL OR kr.cid IS NOT NULL))
    )
    SELECT
        ec.id AS chunk_id,
        ec.source_id,
        ec.source_version_id,
        ec.chunk_index,
        ec.heading,
        ec.content,
        ec.locator,
        f.v_score AS vector_score,
        f.k_score AS keyword_score,
        f.c_score AS combined_score
    FROM fused f
    JOIN eligible_chunks ec ON ec.id = f.cid
    ORDER BY f.c_score DESC, ec.chunk_index ASC
    LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION app.match_chunks(
    uuid[], text, extensions.vector, uuid, app.retrieval_method, integer, integer
) TO app_api, app_worker;

-- =============================================================================
-- 5. RLS & Phân quyền cho `embedding_models` và `chunk_embeddings`
-- =============================================================================

ALTER TABLE app.embedding_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.embedding_models FORCE ROW LEVEL SECURITY;

ALTER TABLE app.chunk_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chunk_embeddings FORCE ROW LEVEL SECURITY;

CREATE POLICY pol_embedding_models_read ON app.embedding_models
    FOR SELECT TO app_api, app_worker
    USING (app.current_user_id() IS NOT NULL OR CURRENT_USER = 'app_worker');

CREATE POLICY pol_embedding_models_admin_write ON app.embedding_models
    FOR ALL TO app_api
    USING (app.is_admin())
    WITH CHECK (app.is_admin());

CREATE POLICY pol_chunk_embeddings_read ON app.chunk_embeddings
    FOR SELECT TO app_api, app_worker
    USING (owner_id = app.current_user_id());

CREATE POLICY pol_chunk_embeddings_worker_write ON app.chunk_embeddings
    FOR ALL TO app_worker
    USING (owner_id = app.current_user_id())
    WITH CHECK (owner_id = app.current_user_id());

GRANT SELECT ON app.embedding_models TO app_api, app_worker;
GRANT INSERT, UPDATE ON app.embedding_models TO app_api;

GRANT SELECT ON app.chunk_embeddings TO app_api, app_worker;
GRANT INSERT, UPDATE, DELETE ON app.chunk_embeddings TO app_worker;

COMMIT;



-- =============================================================================
-- MIGRATION: 007_quizzes_and_attempts.sql
-- =============================================================================

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



-- =============================================================================
-- MIGRATION: 008_review_and_optional_tools.sql
-- =============================================================================

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



COMMIT;
