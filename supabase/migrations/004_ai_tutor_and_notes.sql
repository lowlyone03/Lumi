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
