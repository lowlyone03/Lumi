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
