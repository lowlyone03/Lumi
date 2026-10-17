import pytest
from uuid import UUID
from sqlalchemy import text
from httpx import AsyncClient

from app.core.database import AsyncSessionLocal, scoped_user_session
from tests.conftest import USER_A_ID, USER_B_ID, USER_SUSPENDED_ID, make_jwt

pytestmark = pytest.mark.asyncio

async def test_01_health_check(client: AsyncClient):
    """Kiểm tra máy chủ và kết nối CSDL Supabase hoạt động tốt"""
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["status"] == "healthy"
    assert data["data"]["database"] == "connected"
    assert data["data"]["tables_count"] == 57


async def test_02_auth_missing_token(client: AsyncClient):
    """Không có token -> Chặn ngay 401 Unauthorized"""
    response = await client.get("/api/v1/me")
    assert response.status_code == 401
    assert "MISSING_TOKEN" in response.json()["error"]["code"]


async def test_03_auth_invalid_token(client: AsyncClient):
    """Token giả mạo hoặc sai chữ ký -> Chặn 401 Unauthorized"""
    headers = {"Authorization": "Bearer invalid.fake.token"}
    response = await client.get("/api/v1/me", headers=headers)
    assert response.status_code == 401
    assert "INVALID_TOKEN" in response.json()["error"]["code"]


async def test_04_auth_expired_token(client: AsyncClient):
    """Token đã hết hạn -> Chặn 401 TOKEN_EXPIRED"""
    expired_token = make_jwt(USER_A_ID, "student_a@studyflow.test", expired=True)
    headers = {"Authorization": f"Bearer {expired_token}"}
    response = await client.get("/api/v1/me", headers=headers)
    assert response.status_code == 401
    assert "TOKEN_EXPIRED" in response.json()["error"]["code"]


async def test_05_auth_wrong_audience(client: AsyncClient):
    """Token sai audience (không phải 'authenticated') -> Chặn 401"""
    wrong_aud_token = make_jwt(USER_A_ID, "student_a@studyflow.test", wrong_aud=True)
    headers = {"Authorization": f"Bearer {wrong_aud_token}"}
    response = await client.get("/api/v1/me", headers=headers)
    assert response.status_code == 401
    assert "INVALID_TOKEN" in response.json()["error"]["code"]


async def test_06_suspended_account_blocked(client: AsyncClient, token_suspended: str):
    """Tài khoản bị khóa (suspended) -> Chặn 403 Forbidden (Fail-closed)"""
    headers = {"Authorization": f"Bearer {token_suspended}"}
    response = await client.get("/api/v1/me", headers=headers)
    assert response.status_code == 403
    assert "ACCOUNT_SUSPENDED" in response.json()["error"]["code"]


async def test_07_two_accounts_data_isolation(client: AsyncClient, token_user_a: str, token_user_b: str):
    """
    KIỂM THỬ CÁCH LY 2 TÀI KHOẢN (USER A & USER B):
    1. User A đọc thông tin -> thấy User A.
    2. User B đọc thông tin -> thấy User B.
    3. User A sửa thông tin cá nhân.
    4. User B truy vấn -> hoàn toàn không bị ảnh hưởng và không đọc chéo dữ liệu của A.
    """
    # 1. User A đọc profile
    res_a = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token_user_a}"})
    assert res_a.status_code == 200
    data_a = res_a.json()["data"]
    assert data_a["id"] == str(USER_A_ID)
    assert "Sinh viên A" in data_a["display_name"]

    # 2. User B đọc profile
    res_b = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token_user_b}"})
    assert res_b.status_code == 200
    data_b = res_b.json()["data"]
    assert data_b["id"] == str(USER_B_ID)
    assert "Sinh viên B" in data_b["display_name"]

    # 3. User A cập nhật hồ sơ
    update_res_a = await client.patch(
        "/api/v1/me/profile",
        headers={"Authorization": f"Bearer {token_user_a}"},
        json={
            "display_name": "Nguyễn Văn A (CNTT FBU)",
            "field_of_study": "Công nghệ thông tin",
            "self_declared_level": "intermediate"
        }
    )
    assert update_res_a.status_code == 200
    assert update_res_a.json()["data"]["display_name"] == "Nguyễn Văn A (CNTT FBU)"

    # 4. User B đọc lại profile -> đảm bảo vẫn là User B
    res_b_after = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token_user_b}"})
    assert res_b_after.status_code == 200
    data_b_after = res_b_after.json()["data"]
    assert data_b_after["id"] == str(USER_B_ID)
    assert data_b_after["display_name"] == "Sinh viên B"
    assert data_b_after["field_of_study"] != "Công nghệ thông tin"


async def test_08_preferences_optimistic_concurrency(client: AsyncClient, token_user_a: str):
    """
    Kiểm thử cơ chế đồng bộ đa thiết bị (Revision Control & Optimistic Locking):
    - Đọc preferences hiện tại.
    - Cập nhật đúng expected_revision -> Thành công, revision tăng 1.
    - Gửi request sửa với revision cũ -> Xung đột 409 Conflict.
    """
    headers = {"Authorization": f"Bearer {token_user_a}"}

    # 1. Đọc preferences
    get_res = await client.get("/api/v1/me/preferences", headers=headers)
    assert get_res.status_code == 200
    current_rev = get_res.json()["data"]["revision"]

    # 2. Cập nhật hợp lệ với expected_revision
    patch_res = await client.patch(
        "/api/v1/me/preferences",
        headers=headers,
        json={
            "ai_explain_style": "deep",
            "ui_theme": "dark",
            "font_scale": 1.15,
            "expected_revision": current_rev
        }
    )
    assert patch_res.status_code == 200
    new_rev = patch_res.json()["data"]["revision"]
    assert new_rev == current_rev + 1

    # 3. Gửi lại request với revision cũ -> Bị chặn 409 Conflict
    conflict_res = await client.patch(
        "/api/v1/me/preferences",
        headers=headers,
        json={
            "ai_explain_style": "concise",
            "expected_revision": current_rev  # revision cũ đã lỗi thời
        }
    )
    assert conflict_res.status_code == 409
    assert "REVISION_CONFLICT" in conflict_res.json()["error"]["code"]


async def test_09_rls_connection_leak_prevention():
    """
    KIỂM THỬ KHÔNG RÒ RỈ NGỮ CẢNH RLS KHI TÁI SỬ DỤNG CONNECTION:
    - Mở scoped_user_session cho User A.
    - Khi thoát khỏi scoped session, kiểm tra connection trả về pool:
      Đảm bảo app.user_id bị xóa sổ và ROLE trở lại mặc định.
    """
    # 1. Chạy trong phiên User A
    async with scoped_user_session(USER_A_ID) as session:
        res = await session.execute(text("SELECT nullif(current_setting('app.user_id', true), '')::uuid;"))
        active_uid = res.scalar()
        assert active_uid == USER_A_ID

        # Kiểm tra role đang là app_api
        res_role = await session.execute(text("SELECT CURRENT_USER;"))
        assert res_role.scalar() == "app_api"

    # 2. Mở một session mới từ pool
    async with AsyncSessionLocal() as raw_session:
        res_after = await raw_session.execute(text("SELECT nullif(current_setting('app.user_id', true), '');"))
        leaked_uid = res_after.scalar()
        assert leaked_uid is None, "LỖI BẢO MẬT: app.user_id bị rò rỉ sang kết nối khác trong pool!"

        res_raw_role = await raw_session.execute(text("SELECT CURRENT_USER;"))
        assert res_raw_role.scalar() != "app_api"
