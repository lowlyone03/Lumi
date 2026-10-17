import sys
import os
from pathlib import Path
import time
from uuid import UUID
import pytest
import jwt
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text

# Đưa thư mục backend vào sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import settings
# Đặt Secret cố định cho môi trường kiểm thử
TEST_JWT_SECRET = "test-studyflow-secret-for-cryptographic-jwt-verification-123456"
settings.SUPABASE_JWT_SECRET = TEST_JWT_SECRET

from main import app
from app.core.database import AsyncSessionLocal

USER_A_ID = UUID("11111111-1111-4111-8111-111111111111")
USER_B_ID = UUID("22222222-2222-4222-8222-222222222222")
USER_SUSPENDED_ID = UUID("33333333-3333-4333-8333-333333333333")

def make_jwt(user_id: UUID, email: str, expired: bool = False, wrong_aud: bool = False) -> str:
    """Tạo JWT chuẩn Supabase có chữ ký hợp lệ để kiểm thử"""
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "email": email,
        "aud": "authenticated" if not wrong_aud else "wrong_audience",
        "role": "authenticated",
        "iss": f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1",
        "iat": now,
        "exp": now - 3600 if expired else now + 7200,
    }
    return jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="session", autouse=True)
async def setup_test_users():
    """
    Khởi tạo 3 tài khoản kiểm thử trên Database (User A, User B, Suspended User).
    """
    async with AsyncSessionLocal() as session:
        users_setup_sql = text("""
            INSERT INTO auth.users (id, email)
            VALUES 
                (:uid_a, 'student_a@studyflow.test'),
                (:uid_b, 'student_b@studyflow.test'),
                (:uid_s, 'suspended@studyflow.test')
            ON CONFLICT (id) DO NOTHING;
        """)
        await session.execute(users_setup_sql, {
            "uid_a": str(USER_A_ID),
            "uid_b": str(USER_B_ID),
            "uid_s": str(USER_SUSPENDED_ID),
        })

        await session.execute(text("SELECT app.provision_user_records(:uid, 'Sinh viên A');"), {"uid": str(USER_A_ID)})
        await session.execute(text("SELECT app.provision_user_records(:uid, 'Sinh viên B');"), {"uid": str(USER_B_ID)})
        await session.execute(text("SELECT app.provision_user_records(:uid, 'Tài khoản Bị khóa');"), {"uid": str(USER_SUSPENDED_ID)})

        await session.execute(text("""
            UPDATE app.user_access 
            SET status = 'suspended', status_reason = 'Kiểm thử vi phạm quy chế'
            WHERE user_id = :uid;
        """), {"uid": str(USER_SUSPENDED_ID)})

        await session.execute(text("UPDATE app.profiles SET display_name = 'Sinh viên A' WHERE id = :uid;"), {"uid": str(USER_A_ID)})
        await session.execute(text("UPDATE app.profiles SET display_name = 'Sinh viên B' WHERE id = :uid;"), {"uid": str(USER_B_ID)})

        await session.commit()
    yield


    # Dọn dẹp sau khi kiểm thử (nếu cần)


@pytest.fixture
def token_user_a() -> str:
    return make_jwt(USER_A_ID, "student_a@studyflow.test")


@pytest.fixture
def token_user_b() -> str:
    return make_jwt(USER_B_ID, "student_b@studyflow.test")


@pytest.fixture
def token_suspended() -> str:
    return make_jwt(USER_SUSPENDED_ID, "suspended@studyflow.test")


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
