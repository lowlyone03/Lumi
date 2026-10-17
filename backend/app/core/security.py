import logging
import time
from typing import Optional, Dict, Any
from uuid import UUID
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient, InvalidTokenError, ExpiredSignatureError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from supabase import create_client, Client

from app.core.config import settings
from app.core.database import get_db_session

logger = logging.getLogger("studyflow.security")

# HTTP Bearer scheme
bearer_scheme = HTTPBearer(auto_error=False)

# Khởi tạo Supabase client (dùng để xác thực và tạo Signed URLs cho Storage)
supabase_admin: Client = create_client(
    settings.SUPABASE_URL,
    settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
)

# JWKS Client cache cho Supabase asymmetric keys (RS256/ES256)
jwks_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
jwks_client = PyJWKClient(jwks_url, cache_jwk_set=True, lifespan=3600)

@dataclass
class CurrentUser:
    id: UUID
    email: Optional[str]
    role: str
    status: str

def decode_and_verify_token(token: str) -> Dict[str, Any]:
    """
    Xác minh chữ ký và tính hợp lệ của JWT:
    1. Kiểm tra expiration (exp), audience (aud = 'authenticated'), issuer (iss).
    2. Nếu có SUPABASE_JWT_SECRET trong .env (thuật toán đối xứng HS256): xác minh trực tiếp.
    3. Nếu không: sử dụng JWKS của Supabase (RS256/ES256).
    4. Fallback an toàn: kiểm tra qua Supabase Auth API (get_user).
    """
    try:
        # Trường hợp 1: Có secret HS256 cục bộ
        if settings.SUPABASE_JWT_SECRET:
            payload = jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
                options={"verify_exp": True, "verify_aud": True}
            )
            return payload

        # Trường hợp 2: Xác minh qua JWKS Asymmetric (RS256)
        try:
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience="authenticated",
                options={"verify_exp": True, "verify_aud": True}
            )
            return payload
        except Exception:
            # Trường hợp 3: Fallback qua Supabase Auth SDK
            user_response = supabase_admin.auth.get_user(token)
            if not user_response or not user_response.user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="INVALID_TOKEN: Failed to verify with auth server"
                )
            u = user_response.user
            return {
                "sub": u.id,
                "email": u.email,
                "aud": "authenticated",
                "role": "authenticated"
            }

    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="TOKEN_EXPIRED: The session token has expired"
        )
    except InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"INVALID_TOKEN: {str(e)}"
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db_session)
) -> CurrentUser:
    """
    Dependency bắt buộc xác thực:
    1. Kiểm tra Bearer token trong Header.
    2. Giải mã và xác minh chữ ký.
    3. Truy vấn bảng `app.user_access` để kiểm tra trạng thái tài khoản.
    4. Fail-closed: Nếu không tìm thấy hoặc tài khoản 'suspended' -> Chặn ngay lập tức!
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="MISSING_TOKEN: Authorization Bearer token is required"
        )

    token = credentials.credentials
    payload = decode_and_verify_token(token)

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="INVALID_TOKEN: Subject (sub) is missing"
        )

    try:
        user_id = UUID(sub)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="INVALID_TOKEN: Subject (sub) is not a valid UUID"
        )

    # Kiểm tra trạng thái tài khoản trong CSDL (Fail-closed)
    query = text("""
        SELECT user_id, role, status 
        FROM app.user_access 
        WHERE user_id = :uid;
    """)
    result = await session.execute(query, {"uid": str(user_id)})
    row = result.fetchone()

    if not row:
        # Nếu là tài khoản mới tinh từ Supabase Auth, kiểm tra xem đã provision chưa
        provision_query = text("SELECT app.provision_user_records(:uid, '');")
        await session.execute(provision_query, {"uid": str(user_id)})
        await session.commit()
        
        # Đọc lại
        result = await session.execute(query, {"uid": str(user_id)})
        row = result.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="USER_NOT_PROVISIONED: User access record could not be created"
            )

    user_role = row.role
    user_status = row.status

    if user_status == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ACCOUNT_SUSPENDED: Your account has been temporarily locked"
        )
    elif user_status == "pending_deletion":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ACCOUNT_PENDING_DELETION: This account is scheduled for deletion"
        )
    elif user_status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"ACCOUNT_INACTIVE: Account status is '{user_status}'"
        )

    return CurrentUser(
        id=user_id,
        email=payload.get("email"),
        role=user_role,
        status=user_status
    )


async def get_current_admin(
    current_user: CurrentUser = Depends(get_current_user)
) -> CurrentUser:
    """Dependency chỉ cho phép tài khoản có quyền Admin"""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ADMIN_REQUIRED: This action requires administrator privileges"
        )
    return current_user
