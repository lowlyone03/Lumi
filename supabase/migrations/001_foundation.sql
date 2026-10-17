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
