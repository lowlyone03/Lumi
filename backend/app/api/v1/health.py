from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.schemas.common import APIResponse

router = APIRouter(prefix="/health", tags=["Health & Status"])

@router.get("", response_model=APIResponse[dict])
async def health_check(session: AsyncSession = Depends(get_db_session)):
    """
    Kiểm tra tình trạng máy chủ Backend và kết nối CSDL Supabase.
    """
    try:
        # Kiểm tra truy vấn CSDL
        result = await session.execute(text("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app';"))
        table_count = result.scalar()

        return APIResponse(
            success=True,
            data={
                "status": "healthy",
                "database": "connected",
                "schema": "app",
                "tables_count": table_count,
                "timestamp": datetime.utcnow().isoformat()
            },
            message="Hệ thống Backend StudyFlow AI đang hoạt động bình thường"
        )
    except Exception as e:
        return APIResponse(
            success=False,
            data={"status": "degraded", "database": "error", "error_message": str(e)},
            message="Kết nối cơ sở dữ liệu gặp sự cố"
        )
