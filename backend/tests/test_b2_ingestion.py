import io
import uuid
import pytest
import fitz  # PyMuPDF
from uuid import UUID
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import AsyncSessionLocal, scoped_user_session, scoped_worker_session
from app.services.pdf_parser import pdf_parser
from app.services.embedding_service import embedding_service
from app.worker.ingestion_worker import ingestion_worker
from tests.conftest import USER_A_ID, USER_B_ID

pytestmark = pytest.mark.asyncio

# Global variables shared across the sequential test flow
SHARED_DATA = {
    "source_id": None,
    "version_id": None,
    "job_id": None,
    "sample_pdf_bytes": None,
}


def create_sample_pdf_bytes() -> bytes:
    """Tạo một file PDF mẫu có 2 trang, có tiêu đề và các đoạn văn bằng PyMuPDF"""
    doc = fitz.open()

    # Trang 1
    page1 = doc.new_page()
    page1.insert_text(
        (50, 70),
        "Chương 1: Giới thiệu cấu trúc dữ liệu và giải thuật trong Lumi AI",
        fontsize=16
    )
    page1.insert_text(
        (50, 110),
        "Cấu trúc dữ liệu là cách tổ chức và lưu trữ dữ liệu trong máy tính để có thể sử dụng một cách hiệu quả. "
        "Các cấu trúc dữ liệu cơ bản bao gồm mảng (Array), danh sách liên kết (Linked List), ngăn xếp (Stack), và hàng đợi (Queue). "
        "Việc lựa chọn cấu trúc dữ liệu phù hợp đóng vai trò then chốt trong việc tối ưu hóa hiệu năng của phần mềm.",
        fontsize=11
    )
    page1.insert_text(
        (50, 200),
        "Giải thuật là một tập hợp hữu hạn các chỉ thị được định nghĩa rõ ràng nhằm giải quyết một bài toán cụ thể. "
        "Hiệu năng của thuật toán thường được đánh giá qua độ phức tạp thời gian và không gian sử dụng ký hiệu Big-O.",
        fontsize=11
    )

    # Trang 2
    page2 = doc.new_page()
    page2.insert_text(
        (50, 70),
        "Chương 2: Độ phức tạp thời gian của thuật toán tìm kiếm",
        fontsize=16
    )
    page2.insert_text(
        (50, 110),
        "Thuật toán tìm kiếm tuyến tính có độ phức tạp thời gian là O(n), trong khi tìm kiếm nhị phân có độ phức tạp là O(log n). "
        "Tuy nhiên tìm kiếm nhị phân yêu cầu mảng đầu vào phải được sắp xếp trước.",
        fontsize=11
    )

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


async def test_01_upload_intent_success(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ BƯỚC 1: Khởi tạo ý định tải tài liệu (upload-intent)
    - Người dùng A yêu cầu cấp Signed Upload URL cho file PDF.
    - CSDL ghi nhận Source (pending) và Version (uploading).
    """
    pdf_bytes = create_sample_pdf_bytes()
    SHARED_DATA["sample_pdf_bytes"] = pdf_bytes

    payload = {
        "title": "Giáo trình Cấu trúc dữ liệu và Giải thuật",
        "kind": "pdf",
        "file_name": "gtdst_sample.pdf",
        "mime_type": "application/pdf",
        "size_bytes": len(pdf_bytes),
        "description": "Tài liệu môn học cơ sở ngành CNTT"
    }

    res = await client.post(
        "/api/v1/sources/upload-intent",
        headers={"Authorization": f"Bearer {token_user_a}"},
        json=payload
    )

    assert res.status_code == 201
    data = res.json()["data"]
    assert data["source_id"] is not None
    assert data["version_id"] is not None
    assert "upload_url" in data
    assert "storage_path" in data

    SHARED_DATA["source_id"] = data["source_id"]
    SHARED_DATA["version_id"] = data["version_id"]

    # Kiểm tra CSDL
    async with AsyncSessionLocal() as session:
        src_res = await session.execute(
            text("SELECT status, owner_id FROM app.sources WHERE id = :id;"),
            {"id": data["source_id"]}
        )
        src = src_res.fetchone()
        assert src.status == "pending"
        assert str(src.owner_id) == str(USER_A_ID)

        ver_res = await session.execute(
            text("SELECT status, version_no FROM app.source_versions WHERE id = :id;"),
            {"id": data["version_id"]}
        )
        ver = ver_res.fetchone()
        assert ver.status == "uploading"
        assert ver.version_no == 1


async def test_02_storage_quota_exceeded_rejected(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ BẢO VỆ HẠN MỨC DUNG LƯỢNG:
    - Nếu kích thước file vượt quá hạn mức còn lại của sinh viên -> Chặn ngay 413 Payload Too Large.
    """
    huge_payload = {
        "title": "Tập tài liệu khổng lồ",
        "kind": "pdf",
        "file_name": "huge_file.pdf",
        "mime_type": "application/pdf",
        "size_bytes": 600 * 1024 * 1024  # 600MB (vượt quá 500MB)
    }

    res = await client.post(
        "/api/v1/sources/upload-intent",
        headers={"Authorization": f"Bearer {token_user_a}"},
        json=huge_payload
    )

    assert res.status_code in (413, 422)


async def test_03_upload_complete_and_enqueue_job(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ BƯỚC 2: Xác nhận đã upload xong (upload-complete)
    - Version chuyển sang 'uploaded'.
    - Job xử lý tài liệu (ingest_pdf) được đưa vào bảng app.jobs với idempotency_key.
    """
    source_id = SHARED_DATA["source_id"]
    version_id = SHARED_DATA["version_id"]

    res = await client.post(
        f"/api/v1/sources/{source_id}/upload-complete",
        headers={"Authorization": f"Bearer {token_user_a}"},
        json={"version_id": version_id}
    )

    assert res.status_code == 200
    data = res.json()["data"]
    assert data["job_id"] is not None
    assert data["status"] == "queued"
    SHARED_DATA["job_id"] = data["job_id"]

    # Kiểm tra CSDL
    async with AsyncSessionLocal() as session:
        v_res = await session.execute(
            text("SELECT status FROM app.source_versions WHERE id = :vid;"),
            {"vid": version_id}
        )
        assert v_res.scalar() == "uploaded"

        j_res = await session.execute(
            text("SELECT status, job_type FROM app.jobs WHERE id = :jid;"),
            {"jid": data["job_id"]}
        )
        job = j_res.fetchone()
        assert job.status == "queued"
        assert job.job_type == "ingest_pdf"


async def test_04_pdf_parser_and_locator_validation():
    """
    KIỂM THỬ BỘ TÁCH ĐOẠN PYMUPDF & RÀNG BUỘC LOCATOR CSDL:
    - Bóc tách PDF mẫu 2 trang thành các chunks.
    - Đảm bảo trích xuất tiêu đề (heading) và số lượng token hợp lý.
    - Đảm bảo 100% locator thỏa mãn hàm SQL app.is_valid_locator trên PostgreSQL!
    """
    pdf_bytes = SHARED_DATA["sample_pdf_bytes"]
    parse_result = pdf_parser.parse_pdf(pdf_bytes)

    assert parse_result.page_count == 2
    assert len(parse_result.chunks) >= 2

    async with AsyncSessionLocal() as session:
        for chunk in parse_result.chunks:
            assert chunk.token_count > 0
            assert chunk.content is not None and len(chunk.content.strip()) > 0
            assert chunk.locator["type"] == "pdf_page"
            assert chunk.locator["page"] in (1, 2)

            # Kiểm tra ràng buộc hàm SQL thực tế trên CSDL Supabase
            check_sql = text("SELECT app.is_valid_locator(CAST(:loc AS jsonb));")
            import json
            res = await session.execute(check_sql, {"loc": json.dumps(chunk.locator)})
            assert res.scalar() is True, f"Locator {chunk.locator} không hợp lệ với hàm app.is_valid_locator!"


async def test_05_fastembed_embeddings_generation():
    """
    KIỂM THỬ MÔ HÌNH EMBEDDING (FASTEMBED BGE-SMALL-EN):
    - Sinh vector cho danh sách đoạn văn.
    - Đảm bảo độ dài vector chính xác 384 chiều và không bị rỗng.
    """
    texts = [
        "Lumi AI là nền tảng hỗ trợ học tập thông minh",
        "Cấu trúc dữ liệu và giải thuật trong khoa học máy tính"
    ]
    vectors = embedding_service.embed_documents(texts)
    assert len(vectors) == 2
    assert len(vectors[0]) == 384
    assert len(vectors[1]) == 384
    assert any(v != 0.0 for v in vectors[0])


async def test_06_worker_end_to_end_ingestion():
    """
    KIỂM THỬ TIẾN TRÌNH WORKER CHẠY NGẦM:
    - Worker nhận job từ app.claim_next_job (cấp lock_token ngẫu nhiên).
    - Thực hiện bóc tách, sinh embeddings, và lưu vào CSDL qua app.worker_upsert_chunk.
    - Hoàn tất job qua app.complete_ingest_job:
      + jobs.status -> 'succeeded'
      + source_versions.status -> 'ready'
      + sources.active_version_id -> version_id
      + sources.status -> 'ready'
    """
    # 1. Dọn dẹp job cũ còn tồn dư (nếu có) và Worker claim job
    job_id = SHARED_DATA["job_id"]
    async with AsyncSessionLocal() as session:
        await session.execute(
            text("DELETE FROM app.jobs WHERE id <> :jid AND status IN ('queued', 'running');"),
            {"jid": job_id}
        )
        await session.commit()

    claimed_job = await ingestion_worker.claim_job(lease_seconds=300)
    assert claimed_job is not None
    assert str(claimed_job["id"]) == str(job_id)
    assert claimed_job["lock_token"] is not None
    assert claimed_job["status"] == "running"

    # 2. Xử lý job với PDF mẫu
    pdf_bytes = SHARED_DATA["sample_pdf_bytes"]
    success = await ingestion_worker.process_job(claimed_job, pdf_bytes=pdf_bytes)
    assert success is True

    # 3. Kiểm tra trạng thái CSDL sau khi hoàn thành
    source_id = SHARED_DATA["source_id"]
    version_id = SHARED_DATA["version_id"]
    job_id = SHARED_DATA["job_id"]

    async with AsyncSessionLocal() as session:
        # Kiểm tra Job
        j_res = await session.execute(text("SELECT status FROM app.jobs WHERE id = :id;"), {"id": job_id})
        assert j_res.scalar() == "succeeded"

        # Kiểm tra Version
        v_res = await session.execute(text("SELECT status, page_count FROM app.source_versions WHERE id = :id;"), {"id": version_id})
        v_row = v_res.fetchone()
        assert v_row.status == "ready"
        assert v_row.page_count == 2

        # Kiểm tra Source (active_version_id đã được kích hoạt)
        s_res = await session.execute(text("SELECT status, active_version_id FROM app.sources WHERE id = :id;"), {"id": source_id})
        s_row = s_res.fetchone()
        assert s_row.status == "ready"
        assert str(s_row.active_version_id) == str(version_id)

        # Kiểm tra chunks đã được ghi
        c_res = await session.execute(
            text("SELECT count(*) FROM app.source_chunks WHERE source_version_id = :vid;"),
            {"vid": version_id}
        )
        chunk_count = c_res.scalar()
        assert chunk_count >= 2

        # Kiểm tra embeddings đã được ghi khớp số lượng chunks
        e_res = await session.execute(
            text("SELECT count(*) FROM app.chunk_embeddings WHERE source_version_id = :vid;"),
            {"vid": version_id}
        )
        assert e_res.scalar() == chunk_count


async def test_07_api_get_source_and_chunks(client: AsyncClient, token_user_a: str):
    """
    KIỂM THỬ API ĐỌC THÔNG TIN & CHUNKS TÀI LIỆU ĐÃ READY:
    - User A đọc chi tiết tài liệu -> Thấy status 'ready' và active_version_id.
    - User A lấy danh sách chunks -> Nhận đầy đủ các chunks có locator để hiển thị trích dẫn.
    """
    source_id = SHARED_DATA["source_id"]

    # 1. Đọc chi tiết tài liệu
    res = await client.get(
        f"/api/v1/sources/{source_id}",
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert res.status_code == 200
    src_data = res.json()["data"]
    assert src_data["status"] == "ready"
    assert src_data["active_version"] is not None
    assert src_data["active_version"]["page_count"] == 2

    # 2. Đọc chunks tài liệu
    chunks_res = await client.get(
        f"/api/v1/sources/{source_id}/chunks",
        headers={"Authorization": f"Bearer {token_user_a}"}
    )
    assert chunks_res.status_code == 200
    chunks = chunks_res.json()["data"]
    assert len(chunks) >= 2
    assert "Lumi AI" in chunks[0]["content"]
    assert chunks[0]["locator"]["type"] == "pdf_page"


async def test_08_two_accounts_source_isolation_rls(client: AsyncClient, token_user_b: str):
    """
    KIỂM THỬ CÁCH LY DỮ LIỆU TÀI LIỆU GIỮA 2 TÀI KHOẢN (USER A & USER B):
    - Tài liệu được tạo bởi User A.
    - User B gửi request đọc tài liệu của A -> Bị từ chối 404 Not Found do RLS chặn ở tầng CSDL.
    - User B gửi request đọc chunks của A -> Bị từ chối 404 Not Found.
    - User B liệt kê danh sách tài liệu -> Hoàn toàn không nhìn thấy tài liệu của A.
    """
    source_id = SHARED_DATA["source_id"]

    # 1. User B đọc tài liệu của A
    res_detail = await client.get(
        f"/api/v1/sources/{source_id}",
        headers={"Authorization": f"Bearer {token_user_b}"}
    )
    assert res_detail.status_code == 404

    # 2. User B đọc chunks của A
    res_chunks = await client.get(
        f"/api/v1/sources/{source_id}/chunks",
        headers={"Authorization": f"Bearer {token_user_b}"}
    )
    assert res_chunks.status_code == 404

    # 3. User B xem danh sách tài liệu của mình
    res_list = await client.get(
        "/api/v1/sources",
        headers={"Authorization": f"Bearer {token_user_b}"}
    )
    assert res_list.status_code == 200
    sources_b = res_list.json()["data"]
    source_ids_b = [s["id"] for s in sources_b]
    assert str(source_id) not in source_ids_b, "LỖI BẢO MẬT: User B nhìn thấy tài liệu của User A!"
