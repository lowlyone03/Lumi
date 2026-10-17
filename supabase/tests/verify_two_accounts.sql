-- =============================================================================
-- Kiểm thử Tự động bằng 2 Tài khoản (User A & User B)
-- Dự án: StudyFlow AI
-- Cách chạy: Chạy sau các migration 001..008 trên Supabase SQL Editor hoặc psql.
-- Toàn bộ bài test nằm trong giao dịch `BEGIN ... ROLLBACK` nên không để lại dữ liệu rác.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_user_a uuid := '11111111-1111-4111-8111-111111111111';
    v_user_b uuid := '22222222-2222-4222-8222-222222222222';
    v_admin  uuid := '99999999-9999-4999-8999-999999999999';

    v_src_a uuid;
    v_ver_a1 uuid;
    v_ver_a2 uuid;
    v_job_a uuid;
    v_chunk_a uuid;
    v_tag_a uuid;

    v_src_b uuid;
    v_ver_b1 uuid;
    v_job_b uuid;
    v_chunk_b uuid;
    v_tag_b uuid;

    v_course_a1 uuid;
    v_course_a2 uuid;
    v_chap_a1 uuid;

    v_claimed_1 app.jobs;
    v_claimed_2 app.jobs;
    v_stale_token uuid;

    v_quiz_a uuid;
    v_qver_a uuid;
    v_q1_a uuid;
    v_att_a uuid;
    v_sub1 app.quiz_attempts;
    v_sub2 app.quiz_attempts;

    v_deck_a uuid;
    v_card_a uuid;
    v_rev_ev uuid := extensions.gen_random_uuid();
    v_crev1 app.card_reviews;
    v_crev2 app.card_reviews;

    v_cnt integer;
    v_caught boolean;
BEGIN
    -- 0. Tạo 3 tài khoản (User A, User B, Admin)
    INSERT INTO auth.users (id, email) VALUES
        (v_user_a, 'user_a@studyflow.test'),
        (v_user_b, 'user_b@studyflow.test'),
        (v_admin,  'admin@studyflow.test')
    ON CONFLICT (id) DO NOTHING;

    PERFORM app.provision_user_records(v_user_a, 'Sinh viên A');
    PERFORM app.provision_user_records(v_user_b, 'Sinh viên B');
    PERFORM app.provision_user_records(v_admin,  'Quản trị viên');

    UPDATE app.user_access SET role = 'admin', status = 'active' WHERE user_id = v_admin;

    -- =========================================================================
    -- TEST 1: Người dùng không thể tự nâng quyền lên `admin` hoặc sửa `user_access`
    -- =========================================================================
    SET LOCAL ROLE app_api;
    PERFORM set_config('app.user_id', v_user_a::text, true);

    v_caught := false;
    BEGIN
        UPDATE app.user_access SET role = 'admin' WHERE user_id = v_user_a;
    EXCEPTION WHEN insufficient_privilege THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'TEST 1A FAILED: app_api should not have UPDATE privilege on user_access';

    v_caught := false;
    BEGIN
        PERFORM app.admin_set_user_access(v_user_a, 'admin', 'active', 'tự nâng quyền');
    EXCEPTION WHEN insufficient_privilege THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'TEST 1B FAILED: learner should not be able to call admin_set_user_access';

    -- =========================================================================
    -- TEST 2: Tạo nguồn & phiên bản nguồn cho A và B; kiểm tra cách ly RLS
    -- =========================================================================
    PERFORM set_config('app.user_id', v_user_a::text, true);
    INSERT INTO app.sources (owner_id, kind, title)
    VALUES (v_user_a, 'pdf', 'Giáo trình CSDL của A')
    RETURNING id INTO v_src_a;

    INSERT INTO app.source_versions (source_id, owner_id, version_no, page_count, status)
    VALUES (v_src_a, v_user_a, 1, 20, 'uploaded')
    RETURNING id INTO v_ver_a1;

    INSERT INTO app.jobs (owner_id, job_type, source_id, source_version_id, idempotency_key)
    VALUES (v_user_a, 'ingest_pdf', v_src_a, v_ver_a1, 'job-a-v1')
    RETURNING id INTO v_job_a;

    INSERT INTO app.tags (owner_id, name) VALUES (v_user_a, 'CSDL') RETURNING id INTO v_tag_a;

    -- Chuyển sang User B
    PERFORM set_config('app.user_id', v_user_b::text, true);
    INSERT INTO app.sources (owner_id, kind, title)
    VALUES (v_user_b, 'pdf', 'Tài liệu Mạng máy tính của B')
    RETURNING id INTO v_src_b;

    INSERT INTO app.source_versions (source_id, owner_id, version_no, page_count, status)
    VALUES (v_src_b, v_user_b, 1, 15, 'uploaded')
    RETURNING id INTO v_ver_b1;

    INSERT INTO app.tags (owner_id, name) VALUES (v_user_b, 'MangMayTinh') RETURNING id INTO v_tag_b;

    -- User B đọc `app.sources` chỉ được thấy nguồn của B, KHÔNG thấy nguồn của A
    SELECT count(*) INTO v_cnt FROM app.sources WHERE id = v_src_a;
    ASSERT v_cnt = 0, 'TEST 2A FAILED: User B was able to read User A source';

    -- =========================================================================
    -- TEST 3: Khóa ngoại ghép chặn gắn thẻ hoặc nguồn chéo chủ sở hữu
    -- =========================================================================
    v_caught := false;
    BEGIN
        INSERT INTO app.source_tags (source_id, tag_id, owner_id)
        VALUES (v_src_b, v_tag_a, v_user_b);
    EXCEPTION WHEN foreign_key_violation THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'TEST 3A FAILED: User B attached User A tag to User B source';

    -- `active_version_id` trỏ sang version của nguồn khác phải bị chặn
    RESET ROLE;
    v_caught := false;
    BEGIN
        UPDATE app.sources
        SET active_version_id = v_ver_b1, revision = revision + 1
        WHERE id = v_src_a;
        SET CONSTRAINTS ALL IMMEDIATE;
    EXCEPTION WHEN foreign_key_violation THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'TEST 3B FAILED: sources.active_version_id accepted version from another source';

    -- =========================================================================
    -- TEST 4: Worker nhận Job nguyên tử & Fencing Token (`lock_token`)
    -- =========================================================================
    SET LOCAL ROLE app_worker;
    v_claimed_1 := app.claim_next_job('worker-1', 120);
    ASSERT v_claimed_1.id = v_job_a, 'TEST 4A FAILED: worker-1 did not claim job_a';
    ASSERT v_claimed_1.lock_token IS NOT NULL, 'TEST 4B FAILED: lock_token is null';

    -- Worker thứ 2 gọi `claim_next_job` ngay lúc này phải không nhận trùng `v_job_a`
    v_claimed_2 := app.claim_next_job('worker-2', 120);
    ASSERT v_claimed_2.id IS NULL, 'TEST 4C FAILED: worker-2 claimed already running job_a';

    -- Worker dùng sai `lock_token` (token cũ) bị chặn ghi chunk
    v_stale_token := extensions.gen_random_uuid();
    v_caught := false;
    BEGIN
        PERFORM app.worker_upsert_chunk(
            v_job_a, v_stale_token, 0,
            'Nội dung giả mạo từ worker cũ', 'Chương 1', 15,
            '{"type": "pdf_page", "page": 1}'::jsonb
        );
    EXCEPTION WHEN serialization_failure THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'TEST 4D FAILED: stale lock_token was allowed to write chunk';

    -- Worker dùng đúng `lock_token` ghi chunk thành công & hoàn tất job
    SELECT id INTO v_chunk_a FROM app.worker_upsert_chunk(
        v_job_a, v_claimed_1.lock_token, 0,
        'Khóa chính (Primary Key) dùng để định danh duy nhất một bộ trong quan hệ.',
        'Chương 2: Mô hình quan hệ', 20,
        '{"type": "pdf_page", "page": 5, "page_end": 5}'::jsonb
    );
    PERFORM app.complete_ingest_job(v_job_a, v_claimed_1.lock_token, '{"chunks_created": 1}'::jsonb);

    -- =========================================================================
    -- TEST 5: Kiểm tra `locator` vượt quá `page_count` (20 trang) bị chặn
    -- =========================================================================
    RESET ROLE;
    v_caught := false;
    BEGIN
        INSERT INTO app.source_chunks (
            source_version_id, source_id, owner_id, chunk_index, content, token_count, locator
        )
        VALUES (
            v_ver_a1, v_src_a, v_user_a, 99, 'Trang vượt giới hạn', 5,
            '{"type": "pdf_page", "page": 25}'::jsonb
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'TEST 5 FAILED: locator page > page_count was not rejected';

    -- =========================================================================
    -- TEST 6: Kiểm tra `match_chunks` KHÔNG rò rỉ dữ liệu khi truyền `source_ids` của người khác
    -- =========================================================================
    SET LOCAL ROLE app_api;
    PERFORM set_config('app.user_id', v_user_b::text, true);

    SELECT count(*) INTO v_cnt
    FROM app.match_chunks(
        ARRAY[v_src_a, v_src_b],
        'Khóa chính Primary Key',
        NULL,
        NULL,
        'keyword',
        10
    );
    ASSERT v_cnt = 0, 'TEST 6A FAILED: User B retrieved User A chunks via match_chunks!';

    -- User A gọi `match_chunks` lấy được đúng chunk của mình
    PERFORM set_config('app.user_id', v_user_a::text, true);
    SELECT count(*) INTO v_cnt
    FROM app.match_chunks(
        ARRAY[v_src_a],
        'Khóa chính',
        NULL,
        NULL,
        'keyword',
        10
    );
    ASSERT v_cnt = 1, 'TEST 6B FAILED: User A could not retrieve own ready chunk';

    -- =========================================================================
    -- TEST 7: Kiểm tra Khóa ngoại ghép 3 cột của `lessons` (Chương phải thuộc đúng Khóa học)
    -- =========================================================================
    INSERT INTO app.courses (owner_id, title) VALUES (v_user_a, 'Khóa CSDL') RETURNING id INTO v_course_a1;
    INSERT INTO app.courses (owner_id, title) VALUES (v_user_a, 'Khóa Mạng') RETURNING id INTO v_course_a2;
    INSERT INTO app.chapters (course_id, owner_id, title, position)
    VALUES (v_course_a1, v_user_a, 'Chương 1 CSDL', 1)
    RETURNING id INTO v_chap_a1;

    v_caught := false;
    BEGIN
        -- Cố tình gắn `v_chap_a1` (của Khóa CSDL) vào `v_course_a2` (Khóa Mạng)
        INSERT INTO app.lessons (course_id, chapter_id, owner_id, title, position)
        VALUES (v_course_a2, v_chap_a1, v_user_a, 'Bài học lệch khóa', 1);
    EXCEPTION WHEN foreign_key_violation THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'TEST 7 FAILED: lesson accepted chapter belonging to another course';

    -- =========================================================================
    -- TEST 8: Kiểm tra Đồng bộ `revision` (Cập nhật không tăng revision bị từ chối)
    -- =========================================================================
    v_caught := false;
    BEGIN
        UPDATE app.courses SET title = 'Đổi tên quên tăng revision' WHERE id = v_course_a1;
    EXCEPTION WHEN serialization_failure THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'TEST 8 FAILED: blind update without revision = OLD.revision + 1 was not rejected';

    -- =========================================================================
    -- TEST 9: Quiz — Ẩn `question_keys`, Bất biến đề đã `published` & Nộp bài Idempotent
    -- =========================================================================
    RESET ROLE;
    INSERT INTO app.quizzes (owner_id, course_id, title)
    VALUES (v_user_a, v_course_a1, 'Quiz Chương 1')
    RETURNING id INTO v_quiz_a;

    INSERT INTO app.quiz_versions (quiz_id, owner_id, version_no, status, default_mode, question_count)
    VALUES (v_quiz_a, v_user_a, 1, 'draft', 'practice', 1)
    RETURNING id INTO v_qver_a;

    INSERT INTO app.questions (quiz_version_id, owner_id, position, type, stem, options)
    VALUES (
        v_qver_a, v_user_a, 1, 'single_choice',
        'Khóa chính có được phép mang giá trị NULL không?',
        '[{"id": "A", "text": "Có"}, {"id": "B", "text": "Không"}]'::jsonb
    )
    RETURNING id INTO v_q1_a;

    INSERT INTO app.question_keys (question_id, quiz_version_id, owner_id, answer_key, explanation)
    VALUES (v_q1_a, v_qver_a, v_user_a, '"B"'::jsonb, 'Khóa chính bắt buộc NOT NULL.');

    -- Phát hành đề
    UPDATE app.quiz_versions SET status = 'published', published_at = now() WHERE id = v_qver_a;

    -- 9A. Sau khi `published`, sửa đáp án hoặc câu hỏi phải bị chặn
    v_caught := false;
    BEGIN
        UPDATE app.question_keys SET answer_key = '"A"'::jsonb WHERE question_id = v_q1_a;
    EXCEPTION WHEN insufficient_privilege THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'TEST 9A FAILED: published quiz question_keys was modified';

    -- 9B. `app_api` không được SELECT trực tiếp `question_keys`
    SET LOCAL ROLE app_api;
    PERFORM set_config('app.user_id', v_user_a::text, true);

    v_caught := false;
    BEGIN
        PERFORM count(*) FROM app.question_keys;
    EXCEPTION WHEN insufficient_privilege THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'TEST 9B FAILED: app_api was able to SELECT question_keys directly';

    -- 9C. Làm bài và nộp 2 lần liên tiếp -> trả về cùng 1 kết quả, chấm đúng 1/1
    SELECT id INTO v_att_a FROM app.start_quiz_attempt(v_qver_a, 'practice');

    INSERT INTO app.attempt_answers (attempt_id, quiz_version_id, question_id, owner_id, response)
    VALUES (v_att_a, v_qver_a, v_q1_a, v_user_a, '"B"'::jsonb);

    v_sub1 := app.submit_quiz_attempt(v_att_a);
    v_sub2 := app.submit_quiz_attempt(v_att_a);

    ASSERT v_sub1.status = 'submitted' AND v_sub1.score = 1.0, 'TEST 9C FAILED: wrong score on submit';
    ASSERT v_sub2.finalized_at = v_sub1.finalized_at, 'TEST 9D FAILED: repeat submit re-graded attempt';

    -- =========================================================================
    -- TEST 10: Flashcard Review Idempotent theo `event_id`
    -- =========================================================================
    INSERT INTO app.flashcard_decks (owner_id, course_id, title, schedule_enabled)
    VALUES (v_user_a, v_course_a1, 'Bộ thẻ CSDL', true)
    RETURNING id INTO v_deck_a;

    INSERT INTO app.flashcards (deck_id, owner_id, front, back)
    VALUES (v_deck_a, v_user_a, 'Primary Key là gì?', 'Khóa chính định danh duy nhất một bộ.')
    RETURNING id INTO v_card_a;

    v_crev1 := app.record_card_review(v_rev_ev, v_card_a, 2::smallint);
    v_crev2 := app.record_card_review(v_rev_ev, v_card_a, 2::smallint);

    ASSERT v_crev1.id = v_crev2.id, 'TEST 10 FAILED: duplicate event_id created two card_reviews';

    -- =========================================================================
    -- TEST 11: Khóa tài khoản (`suspended`) chặn ngay lập tức mọi truy vấn dữ liệu
    -- =========================================================================
    PERFORM set_config('app.user_id', v_admin::text, true);
    PERFORM app.admin_set_user_access(v_user_a, 'learner', 'suspended', 'Kiểm thử khóa tài khoản');

    PERFORM set_config('app.user_id', v_user_a::text, true);
    SELECT count(*) INTO v_cnt FROM app.sources;
    ASSERT v_cnt = 0, 'TEST 11A FAILED: suspended user A could still read sources';

    -- Nhưng User A vẫn đọc được dòng `user_access` của chính mình để xem lý do bị khóa
    SELECT count(*) INTO v_cnt FROM app.user_access WHERE user_id = v_user_a AND status = 'suspended';
    ASSERT v_cnt = 1, 'TEST 11B FAILED: suspended user A could not read own user_access status';

    RAISE NOTICE 'ALL 11 SECURITY, ISOLATION & INTEGRITY TEST SUITES PASSED SUCCESSFULLY!';
END;
$$;

ROLLBACK;
