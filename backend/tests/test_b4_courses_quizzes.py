import uuid
import json
import pytest
from uuid import UUID
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from tests.conftest import USER_A_ID, USER_B_ID
from tests.test_b3_rag_chat import ensure_source_ready_for_user_a

pytestmark = pytest.mark.asyncio

B4_SHARED = {
    "source_id": None,
    "source_version_id": None,
    "course_id": None,
    "lesson_id": None,
    "note_id": None,
    "quiz_id": None,
    "quiz_version_id": None,
    "attempt_id": None,
}


@pytest.fixture(autouse=True, scope="module")
def setup_module():
    pass


async def get_user_a_source_and_version():
    """Lấy source_id và version_id hợp lệ của User A để liên kết khóa học và câu hỏi"""
    if B4_SHARED["source_id"] and B4_SHARED["source_version_id"]:
        return B4_SHARED["source_id"], B4_SHARED["source_version_id"]

    source_id = await ensure_source_ready_for_user_a()
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("SELECT active_version_id FROM app.sources WHERE id = :sid"),
            {"sid": str(source_id)},
        )
        version_id = res.scalar()

    B4_SHARED["source_id"] = source_id
    B4_SHARED["source_version_id"] = version_id
    return source_id, version_id


async def ensure_course_for_user_a(client: AsyncClient, token_user_a: str) -> UUID:
    """Đảm bảo User A có khóa học để chạy test độc lập"""
    if B4_SHARED["course_id"]:
        return B4_SHARED["course_id"]

    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("SELECT id FROM app.courses WHERE owner_id = :uid AND deleted_at IS NULL LIMIT 1;"),
            {"uid": USER_A_ID}
        )
        existing = res.scalar()
        if existing:
            B4_SHARED["course_id"] = existing
            return existing

    source_id, _ = await get_user_a_source_and_version()
    payload = {
        "title": "Khóa học Cấu trúc Dữ liệu & Thuật toán Nâng cao",
        "description": "Lộ trình học tập tổng hợp từ giáo trình đại học",
        "color": "#4F46E5",
        "source_ids": [str(source_id)],
    }
    resp = await client.post(
        "/api/v1/courses",
        json=payload,
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp.status_code == 201, resp.text
    B4_SHARED["course_id"] = resp.json()["data"]["id"]
    return B4_SHARED["course_id"]


async def ensure_lesson_for_user_a(client: AsyncClient, token_user_a: str) -> UUID:
    """Đảm bảo User A có ít nhất một bài học (lesson)"""
    if B4_SHARED["lesson_id"]:
        return B4_SHARED["lesson_id"]

    course_id = await ensure_course_for_user_a(client, token_user_a)

    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("SELECT id FROM app.lessons WHERE course_id = :cid AND owner_id = :uid AND deleted_at IS NULL LIMIT 1;"),
            {"cid": str(course_id), "uid": USER_A_ID}
        )
        existing = res.scalar()
        if existing:
            B4_SHARED["lesson_id"] = existing
            return existing
    source_id, _ = await get_user_a_source_and_version()

    # Tạo draft
    resp = await client.post(
        f"/api/v1/courses/{course_id}/curriculum/draft",
        json={"source_ids": [str(source_id)], "target_weeks": 4, "hours_per_week": 6},
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp.status_code in [200, 201], resp.text
    draft_id = resp.json()["data"]["id"]

    # Áp dụng draft
    resp_apply = await client.post(
        f"/api/v1/courses/{course_id}/curriculum/apply",
        json={"draft_id": str(draft_id)},
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_apply.status_code == 200, resp_apply.text

    # Lấy lesson_id
    resp_detail = await client.get(
        f"/api/v1/courses/{course_id}",
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    course_detail = resp_detail.json()["data"]
    lesson_id = course_detail["chapters"][0]["lessons"][0]["id"]
    B4_SHARED["lesson_id"] = lesson_id
    return lesson_id


async def ensure_quiz_version_for_user_a(client: AsyncClient, token_user_a: str) -> UUID:
    """Đảm bảo User A có bộ đề đã xuất bản (published) để làm bài"""
    if B4_SHARED["quiz_version_id"]:
        return B4_SHARED["quiz_version_id"]

    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("""
                SELECT qv.id, qv.quiz_id 
                FROM app.quiz_versions qv
                WHERE qv.owner_id = :uid AND qv.status = 'published'
                LIMIT 1;
            """),
            {"uid": USER_A_ID}
        )
        row = res.first()
        if row:
            B4_SHARED["quiz_version_id"] = row[0]
            B4_SHARED["quiz_id"] = row[1]
            return row[0]

    await test_05_quiz_ai_generation_and_publishing(client, token_user_a)
    return B4_SHARED["quiz_version_id"]


# =====================================================================
# 1. TEST TẠO KHÓA HỌC & LIÊN KẾT TÀI LIỆU
# =====================================================================
async def test_01_create_course_and_link_source(client: AsyncClient, token_user_a: str):
    source_id, _ = await get_user_a_source_and_version()

    payload = {
        "title": "Khóa học Cấu trúc Dữ liệu & Thuật toán Nâng cao",
        "description": "Lộ trình học tập tổng hợp từ giáo trình đại học",
        "color": "#4F46E5",
        "source_ids": [str(source_id)],
    }

    resp = await client.post(
        "/api/v1/courses",
        json=payload,
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()["data"]

    assert data["title"] == payload["title"]
    assert data["status"] == "active"
    B4_SHARED["course_id"] = data["id"]

    # Kiểm tra liên kết trong DB
    async with AsyncSessionLocal() as session:
        cs = (await session.execute(
            text("SELECT source_id FROM app.course_sources WHERE course_id = :cid"),
            {"cid": data["id"]},
        )).scalar()
        assert str(cs) == str(source_id)


# =====================================================================
# 2. TEST SINH ĐỀ CƯƠNG AI & ÁP DỤNG VÀO KHÓA HỌC
# =====================================================================
async def test_02_generate_curriculum_draft_and_apply(client: AsyncClient, token_user_a: str):
    course_id = await ensure_course_for_user_a(client, token_user_a)
    source_id, _ = await get_user_a_source_and_version()

    # Sinh đề cương AI
    resp = await client.post(
        f"/api/v1/courses/{course_id}/curriculum/draft",
        json={
            "source_ids": [str(source_id)],
            "target_weeks": 4,
            "hours_per_week": 6,
        },
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp.status_code in [200, 201], resp.text
    draft_data = resp.json()["data"]
    draft_id = draft_data["id"]
    assert "chapters" in draft_data["content"]
    assert len(draft_data["content"]["chapters"]) >= 1

    # Áp dụng đề cương vào khóa học
    resp_apply = await client.post(
        f"/api/v1/courses/{course_id}/curriculum/apply",
        json={"draft_id": str(draft_id)},
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_apply.status_code == 200, resp_apply.text
    apply_data = resp_apply.json()["data"]
    assert apply_data["chapters_created"] >= 1
    assert apply_data["lessons_created"] >= 1

    # Đọc chi tiết khóa học để lấy lesson_id
    resp_detail = await client.get(
        f"/api/v1/courses/{course_id}",
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_detail.status_code == 200, resp_detail.text
    course_detail = resp_detail.json()["data"]
    assert len(course_detail["chapters"]) >= 1
    first_chapter = course_detail["chapters"][0]
    assert len(first_chapter["lessons"]) >= 1
    first_lesson = first_chapter["lessons"][0]
    B4_SHARED["lesson_id"] = first_lesson["id"]


# =====================================================================
# 3. TEST TIẾN ĐỘ ĐỌC TÀI LIỆU & TIẾN ĐỘ BÀI HỌC
# =====================================================================
async def test_03_track_source_and_lesson_progress(client: AsyncClient, token_user_a: str):
    source_id, version_id = await get_user_a_source_and_version()
    course_id = await ensure_course_for_user_a(client, token_user_a)
    lesson_id = await ensure_lesson_for_user_a(client, token_user_a)

    # 1. Cập nhật tiến độ đọc tài liệu
    locator = {"type": "pdf_page", "page": 2, "page_end": 2}
    resp_src = await client.post(
        f"/api/v1/courses/{course_id}/progress/sources/{source_id}",
        json={
            "source_version_id": str(version_id),
            "last_locator": locator,
        },
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_src.status_code == 200, resp_src.text
    sp_data = resp_src.json()["data"]
    assert sp_data["last_locator"]["page"] == 2

    # 2. Kiểm tra ràng buộc lỗi: có last_locator nhưng thiếu last_source_id -> 400
    resp_bad_lp = await client.post(
        f"/api/v1/courses/{course_id}/progress/lessons/{lesson_id}",
        json={
            "status": "in_progress",
            "last_locator": locator,
        },
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_bad_lp.status_code == 400

    # 3. Cập nhật tiến độ bài học chuẩn xác với cặp last_source_id & last_source_version_id
    resp_les = await client.post(
        f"/api/v1/courses/{course_id}/progress/lessons/{lesson_id}",
        json={
            "status": "completed",
            "last_source_id": str(source_id),
            "last_source_version_id": str(version_id),
            "last_locator": locator,
        },
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_les.status_code == 200, resp_les.text
    lp_data = resp_les.json()["data"]
    assert lp_data["status"] == "completed"
    assert lp_data["last_locator"]["page"] == 2


# =====================================================================
# 4. TEST GHI CHÚ ĐA HÌNH & RÀNG BUỘC TOÀN VẸN
# =====================================================================
async def test_04_polymorphic_notes_crud_and_constraints(client: AsyncClient, token_user_a: str):
    source_id, version_id = await get_user_a_source_and_version()
    course_id = await ensure_course_for_user_a(client, token_user_a)
    lesson_id = await ensure_lesson_for_user_a(client, token_user_a)

    # 1. Tạo note chuẩn
    resp_note = await client.post(
        "/api/v1/notes",
        json={
            "kind": "note",
            "title": "Ghi chú thuật toán cây",
            "body": "Cây đỏ đen có chiều cao tối đa 2*log(n+1)",
            "course_id": str(course_id),
            "lesson_id": str(lesson_id),
        },
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_note.status_code == 201, resp_note.text
    note_id = resp_note.json()["data"]["id"]
    B4_SHARED["note_id"] = note_id

    # 2. Tạo highlight với locator
    resp_hl = await client.post(
        "/api/v1/notes",
        json={
            "kind": "highlight",
            "quote": "Bảng băm có thời gian truy xuất trung bình O(1)",
            "source_id": str(source_id),
            "source_version_id": str(version_id),
            "locator": {"type": "pdf_page", "page": 1, "page_end": 1},
        },
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_hl.status_code == 201, resp_hl.text
    assert resp_hl.json()["data"]["kind"] == "highlight"

    # 3. Tạo câu hỏi sinh viên
    resp_q = await client.post(
        "/api/v1/notes",
        json={
            "kind": "question",
            "title": "Thắc mắc về Đồ thị",
            "body": "Khi nào nên dùng Dijkstra thay vì Bellman-Ford?",
            "status": "open",
        },
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_q.status_code == 201, resp_q.text
    q_data = resp_q.json()["data"]
    assert q_data["status"] == "open"
    assert q_data["resolved_at"] is None

    # 4. Kiểm tra ràng buộc lỗi: kind='highlight' nhưng thiếu quote -> 400
    resp_bad_hl = await client.post(
        "/api/v1/notes",
        json={"kind": "highlight", "body": "thiếu quote"},
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_bad_hl.status_code == 400

    # 5. Kiểm tra ràng buộc lỗi: có lesson_id nhưng thiếu course_id -> 400
    resp_bad_lesson = await client.post(
        "/api/v1/notes",
        json={"kind": "note", "body": "nội dung", "lesson_id": str(lesson_id)},
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_bad_lesson.status_code == 400

    # 6. Cập nhật câu hỏi thành resolved (tg_sync_versioning revision bump)
    q_id = q_data["id"]
    resp_upd = await client.put(
        f"/api/v1/notes/{q_id}",
        json={"status": "resolved"},
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_upd.status_code == 200, resp_upd.text
    assert resp_upd.json()["data"]["status"] == "resolved"
    assert resp_upd.json()["data"]["resolved_at"] is not None

    # 7. Xóa mềm ghi chú
    resp_del = await client.delete(
        f"/api/v1/notes/{note_id}",
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_del.status_code == 200
    # Đảm bảo không còn trong danh sách
    resp_list = await client.get(
        "/api/v1/notes",
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    existing_ids = [n["id"] for n in resp_list.json()["data"]]
    assert note_id not in existing_ids


# =====================================================================
# 5. TEST SINH ĐỀ THI TRẮC NGHIỆM AI & XUẤT BẢN (PUBLISH)
# =====================================================================
async def test_05_quiz_ai_generation_and_publishing(client: AsyncClient, token_user_a: str):
    source_id, _ = await get_user_a_source_and_version()
    course_id = await ensure_course_for_user_a(client, token_user_a)

    # 1. Sinh đề thi trắc nghiệm AI
    resp = await client.post(
        "/api/v1/quizzes",
        json={
            "title": "Kiểm tra 15 phút: Cấu trúc Dữ liệu & Giải thuật",
            "course_id": str(course_id) if course_id else None,
            "source_ids": [str(source_id)],
            "question_count": 3,
            "difficulty": "medium",
            "mode": "practice",
        },
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp.status_code == 201, resp.text
    quiz_data = resp.json()["data"]
    quiz_id = quiz_data["id"]
    version_id = quiz_data["active_version_id"]

    B4_SHARED["quiz_id"] = quiz_id
    B4_SHARED["quiz_version_id"] = version_id

    # 2. Đọc chi tiết bộ đề: Các câu hỏi có stem, options, nhưng KHÔNG có đáp án
    resp_detail = await client.get(
        f"/api/v1/quizzes/{quiz_id}",
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_detail.status_code == 200, resp_detail.text
    detail = resp_detail.json()["data"]
    assert detail["status"] == "draft"
    assert len(detail["questions"]) == 3
    for q in detail["questions"]:
        assert "options" in q
        assert len(q["options"]) >= 2
        # Đảm bảo không có answer_key trong payload trả về sinh viên
        assert "answer_key" not in q
        assert "correct_key" not in q

    # 3. Thử bắt đầu làm bài khi chưa publish -> Phải bị từ chối INVALID_STATE
    resp_start_draft = await client.post(
        f"/api/v1/quizzes/versions/{version_id}/attempts/start",
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_start_draft.status_code == 400

    # 4. Xuất bản bộ đề (Publish)
    resp_pub = await client.post(
        f"/api/v1/quizzes/{quiz_id}/publish",
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_pub.status_code == 200, resp_pub.text


# =====================================================================
# 6. TEST BẮT ĐẦU LÀM BÀI, LƯU ĐÁP ÁN & CHẤM ĐIỂM NGUYÊN TỬ TRÊN DB
# =====================================================================
async def test_06_quiz_attempt_answering_and_atomic_submit(client: AsyncClient, token_user_a: str):
    version_id = await ensure_quiz_version_for_user_a(client, token_user_a)

    # 1. Bắt đầu làm bài
    resp_start = await client.post(
        f"/api/v1/quizzes/versions/{version_id}/attempts/start?mode=practice",
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_start.status_code == 200, resp_start.text
    att_data = resp_start.json()["data"]
    attempt_id = att_data["attempt_id"]
    assert att_data["status"] == "in_progress"
    B4_SHARED["attempt_id"] = attempt_id

    # 2. Lấy danh sách câu hỏi và tra cứu bí mật đáp án đúng từ DB để mô phỏng sinh viên làm bài
    async with AsyncSessionLocal() as session:
        # Lấy câu hỏi và đáp án đúng qua session quản trị (chỉ dùng cho test)
        res = await session.execute(
            text("""
                SELECT q.id, qk.answer_key->>'selected_key' as correct_key
                FROM app.questions q
                JOIN app.question_keys qk ON qk.question_id = q.id
                WHERE q.quiz_version_id = :vid
                ORDER BY q.position ASC;
            """),
            {"vid": str(version_id)},
        )
        questions_with_keys = res.fetchall()

    assert len(questions_with_keys) >= 2
    q1_id, q1_correct_key = questions_with_keys[0]
    q2_id, q2_correct_key = questions_with_keys[1]

    # Sinh viên trả lời đúng câu 1
    resp_ans1 = await client.post(
        f"/api/v1/quizzes/attempts/{attempt_id}/answers",
        json={"question_id": str(q1_id), "selected_key": q1_correct_key},
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_ans1.status_code == 200, resp_ans1.text

    # Sinh viên trả lời sai câu 2 (chọn đáp án khác đáp án đúng)
    wrong_key = "A" if q2_correct_key != "A" else "C"
    resp_ans2 = await client.post(
        f"/api/v1/quizzes/attempts/{attempt_id}/answers",
        json={"question_id": str(q2_id), "selected_key": wrong_key},
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_ans2.status_code == 200, resp_ans2.text

    # 3. Nộp bài và chấm điểm nguyên tử bằng database function app.submit_quiz_attempt
    resp_sub = await client.post(
        f"/api/v1/quizzes/attempts/{attempt_id}/submit",
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_sub.status_code == 200, resp_sub.text
    result = resp_sub.json()["data"]

    assert result["status"] == "submitted"
    assert result["score"] == 1.0  # Đúng câu 1, sai câu 2
    assert result["max_score"] == float(len(questions_with_keys))
    assert result["finalized_at"] is not None

    # 4. Kiểm tra tính Idempotent: Nộp bài lần 2 trả về kết quả cũ mà không lỗi
    resp_sub2 = await client.post(
        f"/api/v1/quizzes/attempts/{attempt_id}/submit",
        headers={"Authorization": f"Bearer {token_user_a}"},
    )
    assert resp_sub2.status_code == 200, resp_sub2.text
    assert resp_sub2.json()["data"]["score"] == 1.0


# =====================================================================
# 7. TEST CÁCH LY RLS ĐA NGƯỜI DÙNG GIỮA TÀI KHOẢN A VÀ B
# =====================================================================
async def test_07_rls_cross_account_isolation_b4(client: AsyncClient, token_user_b: str):
    course_id = B4_SHARED["course_id"] or uuid.uuid4()
    note_id = B4_SHARED["note_id"] or uuid.uuid4()
    quiz_id = B4_SHARED["quiz_id"] or uuid.uuid4()
    version_id = B4_SHARED["quiz_version_id"] or uuid.uuid4()
    attempt_id = B4_SHARED["attempt_id"] or uuid.uuid4()

    # 1. User B không thể truy cập khóa học của User A
    resp_c = await client.get(
        f"/api/v1/courses/{course_id}",
        headers={"Authorization": f"Bearer {token_user_b}"},
    )
    assert resp_c.status_code == 404

    # 2. User B không thể đọc ghi chú của User A
    resp_n = await client.get(
        f"/api/v1/notes/{note_id}",
        headers={"Authorization": f"Bearer {token_user_b}"},
    )
    assert resp_n.status_code == 404

    # 3. User B không thể đọc bộ đề của User A
    resp_q = await client.get(
        f"/api/v1/quizzes/{quiz_id}",
        headers={"Authorization": f"Bearer {token_user_b}"},
    )
    assert resp_q.status_code == 404

    # 4. User B không thể làm bài hoặc nộp bài của User A
    resp_att = await client.post(
        f"/api/v1/quizzes/versions/{version_id}/attempts/start",
        headers={"Authorization": f"Bearer {token_user_b}"},
    )
    assert resp_att.status_code in [400, 404, 500]

    resp_sub = await client.post(
        f"/api/v1/quizzes/attempts/{attempt_id}/submit",
        headers={"Authorization": f"Bearer {token_user_b}"},
    )
    assert resp_sub.status_code in [404, 500]
