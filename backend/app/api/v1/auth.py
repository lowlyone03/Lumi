import time
import uuid
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update, text
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.security import CurrentUser, get_current_user
from app.core.database import AsyncSessionLocal, scoped_user_session
from app.models.user import Profile, UserPreferences, StorageUsage, QuotaPeriod
from app.schemas.common import APIResponse
from app.schemas.auth import (
    ProfileResponse,
    ProfileUpdateRequest,
    PreferencesResponse,
    PreferencesUpdateRequest,
    StorageQuotaResponse,
    WebLoginRequest,
    WebLoginResponse,
)

router = APIRouter(prefix="/me", tags=["User Profile & Preferences"])


@router.get("", response_model=APIResponse[ProfileResponse])
async def get_my_profile(current_user: CurrentUser = Depends(get_current_user)):
    """
    Lấy thông tin hồ sơ của sinh viên hiện tại.
    Chạy trong phiên bảo vệ RLS: SET LOCAL ROLE app_api; app.user_id = :uid
    """
    async with scoped_user_session(current_user.id) as session:
        result = await session.execute(
            select(Profile).where(Profile.id == current_user.id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="PROFILE_NOT_FOUND: Profile record does not exist"
            )

        data = ProfileResponse(
            id=profile.id,
            email=current_user.email,
            display_name=profile.display_name,
            avatar_url=profile.avatar_url,
            field_of_study=profile.field_of_study,
            education_level=profile.education_level,
            interested_subjects=profile.interested_subjects or [],
            self_declared_level=profile.self_declared_level,
            role=current_user.role,
            status=current_user.status,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        )
        return APIResponse(success=True, data=data)


@router.patch("/profile", response_model=APIResponse[ProfileResponse])
async def update_my_profile(
    req: ProfileUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Cập nhật thông tin cá nhân (chỉ các trường cho phép, KHÔNG thể tự sửa role/status).
    """
    async with scoped_user_session(current_user.id) as session:
        result = await session.execute(
            select(Profile).where(Profile.id == current_user.id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail="PROFILE_NOT_FOUND")

        update_data = req.model_dump(exclude_unset=True)
        for key, val in update_data.items():
            setattr(profile, key, val)

        await session.commit()
        await session.refresh(profile)

        data = ProfileResponse(
            id=profile.id,
            email=current_user.email,
            display_name=profile.display_name,
            avatar_url=profile.avatar_url,
            field_of_study=profile.field_of_study,
            education_level=profile.education_level,
            interested_subjects=profile.interested_subjects or [],
            self_declared_level=profile.self_declared_level,
            role=current_user.role,
            status=current_user.status,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        )
        return APIResponse(success=True, data=data, message="Cập nhật thông tin thành công")


@router.get("/preferences", response_model=APIResponse[PreferencesResponse])
async def get_my_preferences(current_user: CurrentUser = Depends(get_current_user)):
    """
    Lấy cấu hình học tập cá nhân (giao diện, cách giải thích AI, công cụ bật/tắt).
    """
    async with scoped_user_session(current_user.id) as session:
        result = await session.execute(
            select(UserPreferences).where(UserPreferences.user_id == current_user.id)
        )
        prefs = result.scalar_one_or_none()
        if not prefs:
            raise HTTPException(status_code=404, detail="PREFERENCES_NOT_FOUND")

        data = PreferencesResponse(
            user_id=prefs.user_id,
            ai_explain_style=prefs.ai_explain_style,
            allow_external_knowledge=prefs.allow_external_knowledge,
            ui_theme=prefs.ui_theme,
            font_scale=float(prefs.font_scale),
            locale=prefs.locale,
            timezone=prefs.timezone,
            visible_tools=prefs.visible_tools,
            quiet_hours_start=prefs.quiet_hours_start,
            quiet_hours_end=prefs.quiet_hours_end,
            revision=prefs.revision
        )
        return APIResponse(success=True, data=data)


@router.patch("/preferences", response_model=APIResponse[PreferencesResponse])
async def update_my_preferences(
    req: PreferencesUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Cập nhật tùy chỉnh học tập (hỗ trợ Optimistic Concurrency qua expected_revision).
    """
    async with scoped_user_session(current_user.id) as session:
        result = await session.execute(
            select(UserPreferences).where(UserPreferences.user_id == current_user.id)
        )
        prefs = result.scalar_one_or_none()
        if not prefs:
            raise HTTPException(status_code=404, detail="PREFERENCES_NOT_FOUND")

        if prefs.revision != req.expected_revision:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"REVISION_CONFLICT: Expected revision {req.expected_revision}, current is {prefs.revision}"
            )

        update_data = req.model_dump(exclude_unset=True, exclude={"expected_revision"})
        for key, val in update_data.items():
            setattr(prefs, key, val)

        # Trigger tg_sync_versioning yêu cầu NEW.revision = OLD.revision + 1
        prefs.revision = prefs.revision + 1

        await session.commit()
        await session.refresh(prefs)

        data = PreferencesResponse(
            user_id=prefs.user_id,
            ai_explain_style=prefs.ai_explain_style,
            allow_external_knowledge=prefs.allow_external_knowledge,
            ui_theme=prefs.ui_theme,
            font_scale=float(prefs.font_scale),
            locale=prefs.locale,
            timezone=prefs.timezone,
            visible_tools=prefs.visible_tools,
            quiet_hours_start=prefs.quiet_hours_start,
            quiet_hours_end=prefs.quiet_hours_end,
            revision=prefs.revision
        )
        return APIResponse(success=True, data=data, message="Cập nhật tùy chỉnh học tập thành công")


@router.get("/quota", response_model=APIResponse[StorageQuotaResponse])
async def get_my_quota(current_user: CurrentUser = Depends(get_current_user)):
    """
    Xem mức sử dụng dung lượng lưu trữ tài liệu và hạn mức yêu cầu AI trong tháng.
    """
    async with scoped_user_session(current_user.id) as session:
        storage_res = await session.execute(
            select(StorageUsage).where(StorageUsage.user_id == current_user.id)
        )
        storage = storage_res.scalar_one_or_none()

        quota_res = await session.execute(
            select(QuotaPeriod)
            .where(QuotaPeriod.user_id == current_user.id)
            .order_by(QuotaPeriod.period_start.desc())
            .limit(1)
        )
        quota = quota_res.scalar_one_or_none()

        used = storage.used_bytes if storage else 0
        limit = storage.limit_bytes if storage else 524288000
        pct = round((used / limit) * 100, 2) if limit > 0 else 0.0

        data = StorageQuotaResponse(
            storage_used_bytes=used,
            storage_limit_bytes=limit,
            storage_percent=pct,
            ai_units_used=quota.ai_unit_used if quota else 0,
            ai_units_limit=quota.ai_unit_limit if quota else 200,
            period_end=quota.period_end.isoformat() if quota else None
        )
        return APIResponse(success=True, data=data)


@router.post("/web-login", response_model=APIResponse[WebLoginResponse])
async def web_login(req: WebLoginRequest):
    """
    Đăng nhập & khởi tạo phiên làm việc thực cho giao diện Web/Desktop Lumi:
    - Ánh xạ định danh email sang UUID cố định (hoặc tài khoản hiện có trong auth.users).
    - Tự động khởi tạo hồ sơ qua app.provision_user_records.
    - Kiểm tra trạng thái tài khoản trong app.user_access.
    - Cấp phát JWT chuẩn có chữ ký mật mã (HS256) tương thích hoàn toàn với cơ chế RLS app_api.
    """
    email_clean = req.email.strip().lower()
    display_name = (req.display_name or email_clean.split("@")[0] or "Sinh viên Lumi").strip()

    # Ánh xạ tài khoản kiểm thử cố định hoặc tạo UUID định danh ổn định theo email
    known_map = {
        "student_a@studyflow.test": uuid.UUID("11111111-1111-4111-8111-111111111111"),
        "an.nguyen@sv.edu.vn": uuid.UUID("11111111-1111-4111-8111-111111111111"),
        "student_b@studyflow.test": uuid.UUID("22222222-2222-4222-8222-222222222222"),
        "suspended@studyflow.test": uuid.UUID("33333333-3333-4333-8333-333333333333"),
    }
    user_id = known_map.get(email_clean) or uuid.uuid5(uuid.NAMESPACE_DNS, f"lumi.fbu.{email_clean}")

    async with AsyncSessionLocal() as session:
        await session.execute(
            text("""
                INSERT INTO auth.users (id, email)
                VALUES (:uid, :email)
                ON CONFLICT (id) DO NOTHING;
            """),
            {"uid": str(user_id), "email": email_clean},
        )
        await session.execute(
            text("SELECT app.provision_user_records(:uid, :dname);"),
            {"uid": str(user_id), "dname": display_name},
        )
        if req.display_name and req.display_name.strip():
            await session.execute(
                text("UPDATE app.profiles SET display_name = :dname, updated_at = now() WHERE id = :uid;"),
                {"uid": str(user_id), "dname": display_name},
            )
        await session.commit()

        # Kiểm tra quyền truy cập
        acc_res = await session.execute(
            text("SELECT role, status FROM app.user_access WHERE user_id = :uid;"),
            {"uid": str(user_id)},
        )
        acc = acc_res.first()
        if not acc or acc.status != "active":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"ACCOUNT_INACTIVE: Tài khoản đang ở trạng thái '{acc.status if acc else 'unknown'}'",
            )

    async with scoped_user_session(user_id) as user_session:
        p_res = await user_session.execute(select(Profile).where(Profile.id == user_id))
        profile = p_res.scalar_one()

        now = int(time.time())
        secret = settings.SUPABASE_JWT_SECRET or "test-studyflow-secret-for-cryptographic-jwt-verification-123456"
        payload = {
            "sub": str(user_id),
            "email": email_clean,
            "aud": "authenticated",
            "role": "authenticated",
            "iss": f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1",
            "iat": now,
            "exp": now + 86400 * 7,
        }
        access_token = jwt.encode(payload, secret, algorithm="HS256")

        profile_resp = ProfileResponse(
            id=profile.id,
            email=email_clean,
            display_name=profile.display_name,
            avatar_url=profile.avatar_url,
            field_of_study=profile.field_of_study,
            education_level=profile.education_level,
            interested_subjects=profile.interested_subjects or [],
            self_declared_level=profile.self_declared_level,
            role=acc.role,
            status=acc.status,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        )

        return APIResponse(
            success=True,
            data=WebLoginResponse(access_token=access_token, user=profile_resp),
            message="Đăng nhập hệ thống Lumi thành công",
        )

