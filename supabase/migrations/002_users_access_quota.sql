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
