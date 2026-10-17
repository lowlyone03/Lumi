import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_01_web_ui_served_correctly(client: AsyncClient):
    """Kiểm tra giao diện Lumi Web & Desktop được phục vụ tại /app/index.html"""
    res = await client.get("/app/index.html")
    assert res.status_code == 200
    assert "Lumi — Học theo nhịp của bạn" in res.text
    assert 'src="api.js"' in res.text

    res_js = await client.get("/app/api.js")
    assert res_js.status_code == 200
    assert "initLumiBackendSession" in res_js.text


async def test_02_web_login_and_direct_ingest(client: AsyncClient):
    """Kiểm tra luồng đăng nhập Web UI (/me/web-login) và tải học liệu trực tiếp (/sources/web-ingest)"""
    login_res = await client.post(
        "/api/v1/me/web-login",
        json={"email": "an.nguyen@sv.edu.vn", "display_name": "Nguyễn Văn An"},
    )
    assert login_res.status_code == 200
    body = login_res.json()
    assert body["success"] is True
    token = body["data"]["access_token"]
    assert token

    headers = {"Authorization": f"Bearer {token}"}

    # Tải học liệu từ Web UI
    ingest_res = await client.post(
        "/api/v1/sources/web-ingest",
        headers=headers,
        json={
            "title": "Tai_lieu_kiem_thu_Web_Desktop.pdf",
            "kind": "pdf",
            "text_content": (
                "Chương 1: Tổng quan về Cây tìm kiếm nhị phân (BST).\n"
                "Cây tìm kiếm nhị phân cho phép tra cứu khóa trung bình trong thời gian O(log n).\n\n"
                "Chương 2: Cây cân bằng Đỏ-Đen và B-Tree trong Cơ sở dữ liệu.\n"
                "B-Tree giảm số lần truy cập đĩa cứng khi tìm kiếm chỉ mục trên hệ quản trị PostgreSQL."
            ),
        },
    )
    assert ingest_res.status_code == 201
    src = ingest_res.json()["data"]
    assert src["status"] == "ready"
    assert src["active_version"]["page_count"] >= 1
