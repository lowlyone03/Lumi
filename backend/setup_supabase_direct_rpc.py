import asyncio
from app.core.database import engine

SQL = """
CREATE OR REPLACE FUNCTION public.lumi_cloud_api(p_action text, p_payload jsonb DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $func$
DECLARE
    v_uid uuid := COALESCE(CAST(p_payload->>'user_id' AS uuid), '11111111-1111-4111-8111-111111111111'::uuid);
    v_res jsonb;
    v_id uuid;
BEGIN
    IF p_action = 'web_login' THEN
        SELECT jsonb_build_object(
            'access_token', 'supabase-direct-cloud-token',
            'user', jsonb_build_object(
                'id', p.id,
                'email', COALESCE(p_payload->>'email', 'an.nguyen@sv.edu.vn'),
                'display_name', COALESCE(NULLIF(p_payload->>'display_name', ''), p.display_name, 'Nguyễn Văn An')
            )
        )
        INTO v_res
        FROM app.profiles p
        WHERE p.id = v_uid;

        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'list_sources' THEN
        SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        INTO v_res
        FROM (
            SELECT
                s.id,
                s.title,
                s.kind,
                s.status,
                s.created_at,
                jsonb_build_object(
                    'id', sv.id,
                    'version_no', COALESCE(sv.version_no, 1),
                    'page_count', COALESCE(sv.page_count, 42)
                ) AS active_version
            FROM app.sources s
            LEFT JOIN app.source_versions sv ON sv.id = s.active_version_id
            WHERE s.owner_id = v_uid AND s.deleted_at IS NULL
            ORDER BY s.created_at DESC
        ) t;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'get_chunks' THEN
        SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        INTO v_res
        FROM (
            SELECT
                c.id,
                c.chunk_index,
                c.heading,
                c.content,
                c.locator,
                COALESCE(CAST(c.locator->>'page' AS int), c.chunk_index + 1) AS page_number
            FROM app.source_chunks c
            WHERE c.source_id = CAST(p_payload->>'source_id' AS uuid)
            ORDER BY c.chunk_index ASC
        ) t;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'delete_source' THEN
        UPDATE app.sources
        SET deleted_at = now(), revision = revision + 1, updated_at = now()
        WHERE id = CAST(p_payload->>'source_id' AS uuid) AND owner_id = v_uid;
        RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('deleted', true));

    ELSIF p_action = 'list_notes' THEN
        SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        INTO v_res
        FROM (
            SELECT id, kind, title, body, quote, source_id, locator, revision, created_at, updated_at
            FROM app.notes
            WHERE owner_id = v_uid AND deleted_at IS NULL
            ORDER BY updated_at DESC
        ) t;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'create_note' THEN
        v_id := gen_random_uuid();
        INSERT INTO app.notes (id, owner_id, kind, title, body, quote, source_id, locator, revision, change_seq, created_at, updated_at)
        VALUES (
            v_id,
            v_uid,
            CAST(COALESCE(p_payload->>'kind', 'note') AS app.note_kind),
            COALESCE(p_payload->>'title', 'Sổ tay học tập'),
            COALESCE(p_payload->>'body', ''),
            p_payload->>'quote',
            CAST(NULLIF(p_payload->>'source_id', '') AS uuid),
            COALESCE(p_payload->'locator', '{"type":"page","page":1}'::jsonb),
            1, 1, now(), now()
        );
        SELECT to_jsonb(n) INTO v_res FROM app.notes n WHERE n.id = v_id;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'update_note' THEN
        UPDATE app.notes
        SET
            title = COALESCE(p_payload->>'title', title),
            body = COALESCE(p_payload->>'body', body),
            revision = revision + 1,
            updated_at = now()
        WHERE id = CAST(p_payload->>'note_id' AS uuid) AND owner_id = v_uid
        RETURNING to_jsonb(notes.*) INTO v_res;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'delete_note' THEN
        UPDATE app.notes
        SET deleted_at = now(), revision = revision + 1, updated_at = now()
        WHERE id = CAST(p_payload->>'note_id' AS uuid) AND owner_id = v_uid;
        RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('deleted', true));

    ELSIF p_action = 'list_courses' THEN
        SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        INTO v_res
        FROM (
            SELECT id, title, description, goal, status, color, revision, created_at, updated_at
            FROM app.courses
            WHERE owner_id = v_uid AND deleted_at IS NULL
            ORDER BY updated_at DESC
        ) t;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'create_course' THEN
        v_id := gen_random_uuid();
        INSERT INTO app.courses (id, owner_id, title, description, goal, status, revision, change_seq, created_at, updated_at)
        VALUES (
            v_id,
            v_uid,
            COALESCE(p_payload->>'title', 'Khóa học mới'),
            COALESCE(p_payload->>'description', ''),
            COALESCE(p_payload->>'goal', ''),
            'active',
            1, 1, now(), now()
        );
        SELECT to_jsonb(c) INTO v_res FROM app.courses c WHERE c.id = v_id;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'list_decks' THEN
        SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        INTO v_res
        FROM (
            SELECT id, title, description, schedule_enabled, revision, created_at
            FROM app.flashcard_decks
            WHERE owner_id = v_uid AND deleted_at IS NULL
            ORDER BY created_at DESC
        ) t;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'create_deck' THEN
        v_id := gen_random_uuid();
        INSERT INTO app.flashcard_decks (id, owner_id, title, description, schedule_enabled, revision, change_seq, created_at, updated_at)
        VALUES (v_id, v_uid, COALESCE(p_payload->>'title', 'Bộ thẻ ôn tập Lumi AI'), COALESCE(p_payload->>'description', ''), true, 1, 1, now(), now());
        SELECT to_jsonb(d) INTO v_res FROM app.flashcard_decks d WHERE d.id = v_id;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'list_cards' THEN
        SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        INTO v_res
        FROM (
            SELECT id, deck_id, front, back, source_id, locator, status, revision
            FROM app.flashcards
            WHERE owner_id = v_uid AND deleted_at IS NULL
            ORDER BY created_at ASC
        ) t;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'create_card' THEN
        v_id := gen_random_uuid();
        INSERT INTO app.flashcards (id, deck_id, owner_id, front, back, origin, status, revision, change_seq, created_at, updated_at)
        VALUES (
            v_id,
            CAST(p_payload->>'deck_id' AS uuid),
            v_uid,
            COALESCE(p_payload->>'front', ''),
            COALESCE(p_payload->>'back', ''),
            'user',
            'active',
            1, 1, now(), now()
        );
        SELECT to_jsonb(f) INTO v_res FROM app.flashcards f WHERE f.id = v_id;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'update_card' THEN
        UPDATE app.flashcards
        SET
            front = COALESCE(p_payload->>'front', front),
            back = COALESCE(p_payload->>'back', back),
            revision = revision + 1,
            updated_at = now()
        WHERE id = CAST(p_payload->>'card_id' AS uuid) AND owner_id = v_uid
        RETURNING to_jsonb(flashcards.*) INTO v_res;
        RETURN jsonb_build_object('success', true, 'data', v_res);

    ELSIF p_action = 'delete_card' THEN
        UPDATE app.flashcards
        SET deleted_at = now(), revision = revision + 1, updated_at = now()
        WHERE id = CAST(p_payload->>'card_id' AS uuid) AND owner_id = v_uid;
        RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('deleted', true));
    END IF;

    RETURN jsonb_build_object('success', false, 'message', 'Unknown action');
END;
$func$;

GRANT EXECUTE ON FUNCTION public.lumi_cloud_api(text, jsonb) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
"""

async def main():
    async with engine.connect() as conn:
        raw_conn = await conn.get_raw_connection()
        # asyncpg raw connection allows executing multiple statements without colon param parsing
        await raw_conn.driver_connection.execute(SQL)
        print("SUCCESS: public.lumi_cloud_api created on Supabase Cloud!")

if __name__ == "__main__":
    asyncio.run(main())
