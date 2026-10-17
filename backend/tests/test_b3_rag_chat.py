import uuid
import json
import pytest
from uuid import UUID
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import AsyncSessionLocal, scoped_user_session, scoped_worker_session
from app.services.rag_service import rag_service
from app.services.embedding_service import embedding_service
from app.worker.ingestion_worker import ingestion_worker
from tests.conftest import USER_A_ID, USER_B_ID
from tests.test_b2_ingestion import create_sample_pdf_bytes

pytestmark = pytest.mark.asyncio

SHARED = {
    "source_id": None,
    "conv_id": None,
    "asst_msg_id": None,
}


@pytest.fixture(autouse=True, scope="module")
def setup_module():
    pass


async def ensure_source_ready_for_user_a() -> UUID:
    """Đảm bảo User A có ít nhất một tài liệu ở trạng thái 'ready' với chunks và embeddings"""
    if SHARED["source_id"]:
        return SHARED["source_id"]

    # 1. Tìm source ready hiện có
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("""
                SELECT s.id 
                FROM app.sources s
                JOIN app.source_chunks sc ON sc.source_id = s.id
                JOIN app.chunk_embeddings ce ON ce.chunk_id = sc.id
                WHERE s.owner_id = :uid 
                  AND s.status = 'ready' 
                  AND s.active_version_id IS NOT NULL
                LIMIT 1;
            """),
            {"uid": USER_A_ID}
        )
        existing = res.scalar()
        if existing:
            SHARED["source_id"] = existing
            return existing

    # 2. Nếu chưa có, nạp qua IngestionWorker
    source_id = uuid.uuid4()
    version_id = uuid.uuid4()
    job_id = uuid.uuid4()
    pdf_bytes = create_sample_pdf_bytes()

    async with AsyncSessionLocal() as session:
        # Nạp Source & Version
        await session.execute(text("""
            INSERT INTO app.sources (id, owner_id, kind, title, status)
            VALUES (:sid, :uid, 'pdf', 'Giáo trình Cấu trúc dữ liệu và Giải thuật', 'pending');
        """), {"sid": str(source_id), "uid": USER_A_ID})

        await session.execute(text("""
            INSERT INTO app.source_versions (id, source_id, owner_id, version_no, storage_path, mime_type, size_bytes, status)
            VALUES (:vid, :sid, :uid, 1, 'sources/test.pdf', 'application/pdf', :sz, 'uploaded');
        """), {"vid": str(version_id), "sid": str(source_id), "uid": USER_A_ID, "sz": len(pdf_bytes)})

        # Tạo Job
        await session.execute(text("""
            INSERT INTO app.jobs (id, owner_id, job_type, source_id, source_version_id, status, stage, idempotency_key)
            VALUES (:jid, :uid, 'ingest_pdf', :sid, :vid, 'queued', 'queued', :ikey);
        """), {"jid": str(job_id), "uid": USER_A_ID, "sid": str(source_id), "vid": str(version_id), "ikey": f"ingest:{source_id}"})
        await session.commit()

    # Worker thực thi
    job_info = await ingestion_worker.claim_job()
    if job_info:
        await ingestion_worker.process_job(job_info, pdf_bytes=pdf_bytes)

    SHARED["source_id"] = source_id
    return source_id


async def test_01_create_conversation_success(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ KHỞI TẠO HỘI THOẠI HỎI ĐÁP:
    - Sinh viên A tạo cuộc trò chuyện gắn với tài liệu học tập của mình.
    - Kiểm tra phản hồi 201 Created và liên kết đúng source_id.
    """
    source_id = await ensure_source_ready_for_user_a()

    payload = {
        "title": "Hỏi đáp Ôn tập Cấu trúc dữ liệu & Giải thuật",
        "source_ids": [str(source_id)],
        "scope_type": "single_source",
        "explain_style": "deep"
    }

    res = await client.post(
        "/api/v1/conversations",
        headers={"Authorization": f"Bearer {token_user_a}"},
        json=payload
    )

    assert res.status_code == 201
    body = res.json()
    assert body["success"] is True
    data = body["data"]
    assert data["title"] == payload["title"]
    assert data["explain_style"] == "deep"
    assert len(data["sources"]) == 1
    assert data["sources"][0]["source_id"] == str(source_id)

    SHARED["conv_id"] = data["id"]


async def test_02_create_conversation_unowned_source_rejected(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ BẢO MẬT:
    - Sinh viên A cố tình tạo hội thoại gắn với source_id giả định hoặc của người khác.
    - Backend kiểm tra quyền sở hữu và từ chối 400 Bad Request.
    """
    fake_source_id = str(uuid.uuid4())
    payload = {
        "title": "Hack hội thoại",
        "source_ids": [fake_source_id]
    }

    res = await client.post(
        "/api/v1/conversations",
        headers={"Authorization": f"Bearer {token_user_a}"},
        json=payload
    )

    assert res.status_code == 400
    assert "INVALID_SOURCES" in json.dumps(res.json())


async def test_03_rag_hybrid_retrieval(token_user_a: str):
    """
    KIỂM THỬ TRUY XUẤT RAG HYBRID QUA HÀM CSDL app.match_chunks:
    - Tìm kiếm kết hợp Vector (FastEmbed 384 dims) và Full-Text Search qua RRF.
    - Trả về các chunk khớp ngữ nghĩa kèm điểm số.
    """
    source_id = await ensure_source_ready_for_user_a()

    async with scoped_user_session(UUID(str(USER_A_ID))) as session:
        chunks = await rag_service.retrieve_chunks(
            session=session,
            source_ids=[UUID(str(source_id))],
            query_text="Độ phức tạp thuật toán tìm kiếm nhị phân",
            match_count=5
        )

        assert len(chunks) > 0
        top_chunk = chunks[0]
        assert top_chunk.content is not None
        assert top_chunk.combined_score > 0
        assert top_chunk.locator.get("type") == "pdf_page"


async def test_04_radox_chat_completion_non_streaming(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ HỎI ĐÁP ĐỒNG BỘ (NON-STREAMING) VỚI RADOX AI:
    - Kiểm tra chu trình 2 transaction: Giữ Quota -> Gọi AI Radox Gateway -> Lưu Messages & Quyết toán Quota.
    - Kiểm tra phản hồi có chứa trích dẫn citations gắn đúng locator PDF.
    """
    conv_id = SHARED["conv_id"]
    assert conv_id is not None

    payload = {
        "content": "Thuật toán tìm kiếm nhị phân có độ phức tạp là bao nhiêu và yêu cầu điều kiện gì của mảng đầu vào?",
        "intent": "ask"
    }

    res = await client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        headers={"Authorization": f"Bearer {token_user_a}"},
        json=payload
    )

    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    data = body["data"]

    assert data["role"] == "assistant"
    assert len(data["content"]) > 10
    assert data["status"] == "completed"
    assert data["source_sufficiency"] in ("sufficient", "partial")

    # Kiểm tra trích dẫn citations
    assert len(data["citations"]) >= 1
    first_cit = data["citations"][0]
    assert first_cit["ordinal"] >= 1
    assert first_cit["locator"]["type"] == "pdf_page"
    assert "page" in first_cit["locator"]

    SHARED["asst_msg_id"] = data["id"]


async def test_05_radox_chat_streaming_sse(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ SERVER-SENT EVENTS (SSE) STREAMING:
    - Gửi request tới /messages/stream.
    - Nhận và xác thực 4 loại sự kiện chuẩn: message_started, delta, citations, completed.
    - Kiểm tra token được stream thời gian thực và ghi nhận vào CSDL.
    """
    conv_id = SHARED["conv_id"]
    assert conv_id is not None

    payload = {
        "content": "Hãy tóm tắt ngắn gọn các cấu trúc dữ liệu cơ bản được nêu trong tài liệu.",
        "intent": "summarize"
    }

    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv_id}/messages/stream",
        headers={"Authorization": f"Bearer {token_user_a}"},
        json=payload
    ) as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        events_received = set()
        deltas = []
        citations_data = []

        current_event = None
        async for line in response.aiter_lines():
            line = line.strip()
            if not line:
                continue
            if line.startswith("event:"):
                current_event = line.replace("event:", "").strip()
                events_received.add(current_event)
            elif line.startswith("data:"):
                data_str = line.replace("data:", "").strip()
                data_json = json.loads(data_str)
                if current_event == "delta":
                    deltas.append(data_json.get("delta", ""))
                elif current_event == "citations":
                    citations_data = data_json

        # Xác thực nhận đủ các sự kiện cốt lõi
        assert "message_started" in events_received
        assert "delta" in events_received
        assert "citations" in events_received
        assert "completed" in events_received

        # Xác thực có tokens sinh ra
        full_streamed_text = "".join(deltas)
        assert len(full_streamed_text) > 10
        assert len(citations_data) >= 1


async def test_06_get_conversation_detail_and_messages(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ TRUY VẤN LỊCH SỬ HỘI THOẠI & TIN NHẮN:
    - Đọc chi tiết cuộc trò chuyện qua GET /conversations/{id}.
    - Xác nhận toàn bộ tin nhắn User và Assistant đã được lưu trữ kèm citations.
    """
    conv_id = SHARED["conv_id"]
    assert conv_id is not None

    res = await client.get(
        f"/api/v1/conversations/{conv_id}",
        headers={"Authorization": f"Bearer {token_user_a}"}
    )

    assert res.status_code == 200
    data = res.json()["data"]
    assert data["id"] == conv_id
    assert len(data["messages"]) >= 4  # 2 lượt hỏi đáp (2 user + 2 assistant)

    # Kiểm tra tin nhắn assistant cuối cùng
    last_assistant_msg = [m for m in data["messages"] if m["role"] == "assistant"][-1]
    assert len(last_assistant_msg["citations"]) >= 1
    assert last_assistant_msg["citations"][0]["locator"]["type"] == "pdf_page"


async def test_07_ai_quota_reservation_and_tracking(token_user_a: str):
    """
    KIỂM THỬ THEO DÕI HẠN MỨC AI QUOTA:
    - Xác nhận các bản ghi app.ai_requests được chuyển sang trạng thái 'committed'.
    - Xác nhận số lượt sử dụng được cộng dồn chính xác.
    """
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("""
                SELECT count(*), sum(committed_units) 
                FROM app.ai_requests 
                WHERE user_id = :uid AND status = 'committed';
            """),
            {"uid": USER_A_ID}
        )
        row = res.first()
        committed_count = row[0]
        committed_units = row[1]

        assert committed_count >= 2
        assert committed_units >= 2


async def test_08_two_accounts_conversation_isolation_rls(client: AsyncClient, token_user_b: str):
    """
    KIỂM THỬ CÁCH LY HỘI THOẠI & TRÍCH DẪN GIỮA 2 TÀI KHOẢN (USER A & USER B):
    - User B gửi request đọc cuộc trò chuyện của User A -> Bị từ chối 404 Not Found.
    - User B gửi request gửi tin nhắn vào cuộc trò chuyện của User A -> Bị từ chối 404 Not Found.
    - User B liệt kê danh sách hội thoại -> Hoàn toàn không nhìn thấy hội thoại của User A.
    """
    conv_id = SHARED["conv_id"]
    assert conv_id is not None

    # 1. User B cố đọc hội thoại của User A
    res_get = await client.get(
        f"/api/v1/conversations/{conv_id}",
        headers={"Authorization": f"Bearer {token_user_b}"}
    )
    assert res_get.status_code == 404
    assert "CONVERSATION_NOT_FOUND" in json.dumps(res_get.json())

    # 2. User B cố gửi tin nhắn vào hội thoại của User A
    res_post = await client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        headers={"Authorization": f"Bearer {token_user_b}"},
        json={"content": "Tôi có thể đọc được tin nhắn này không?"}
    )
    assert res_post.status_code == 404
    assert "CONVERSATION_NOT_FOUND" in json.dumps(res_post.json())

    # 3. User B liệt kê hội thoại -> 0 cuộc hội thoại
    res_list = await client.get(
        "/api/v1/conversations",
        headers={"Authorization": f"Bearer {token_user_b}"}
    )
    assert res_list.status_code == 200
    assert len(res_list.json()["data"]) == 0
