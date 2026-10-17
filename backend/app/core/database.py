import logging
from typing import AsyncGenerator, Optional
from contextlib import asynccontextmanager
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    AsyncEngine,
    create_async_engine,
    async_sessionmaker,
)
from app.core.config import settings

logger = logging.getLogger("studyflow.database")

# Khởi tạo Async Engine
# Ghi chú quan trọng: statement_cache_size=0 là bắt buộc khi kết nối qua Transaction Pooler (PgBouncer)
engine: AsyncEngine = create_async_engine(
    settings.async_database_url,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_TIMEOUT_SECONDS,
    pool_pre_ping=True,  # Kiểm tra kết nối còn sống trước khi cấp phát
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "command_timeout": 30,
    },
    echo=settings.DEBUG and not settings.is_production,
)

# Async Session Factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency cung cấp Session CSDL cơ bản (không gán user context).
    Dành cho các endpoint hệ thống (health check, background monitoring).
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@asynccontextmanager
async def scoped_user_session(user_id: UUID) -> AsyncGenerator[AsyncSession, None]:
    """
    Context manager an toàn tuyệt đối cho người dùng:
    1. Mở Transaction riêng biệt.
    2. Thực thi: SET LOCAL ROLE app_api; SELECT set_config('app.user_id', :uid, true);
    3. Mọi truy vấn bên trong đều bị ràng buộc bởi RLS.
    4. Tự động commit nếu transaction vẫn còn mở khi thoát, hoặc rollback nếu phát sinh lỗi.
    5. Khi kết thúc transaction (commit/rollback), PostgreSQL tự động hủy ROLE và app.user_id.
    """
    async with AsyncSessionLocal() as session:
        try:
            if not session.in_transaction():
                await session.begin()
            # Kích hoạt Role nghiệp vụ app_api (không có BYPASSRLS)
            await session.execute(text("SET LOCAL ROLE app_api;"))
            # Thiết lập định danh người dùng trong phạm vi transaction hiện tại
            await session.execute(
                text("SELECT set_config('app.user_id', :uid, true);"),
                {"uid": str(user_id)}
            )
            yield session
            if session.in_transaction():
                await session.commit()
        except Exception as e:
            if session.in_transaction():
                await session.rollback()
            logger.error(f"Error in scoped_user_session for user {user_id}: {e}")
            raise
        finally:
            await session.close()


@asynccontextmanager
async def scoped_worker_session(user_id: Optional[UUID] = None) -> AsyncGenerator[AsyncSession, None]:
    """
    Context manager dành riêng cho Background Ingestion Worker:
    Kích hoạt ROLE app_worker để thực hiện claim_next_job và worker_upsert_chunk.
    Nếu có user_id, thiết lập app.user_id để thỏa mãn các policy RLS (chunk_embeddings, source_warnings).
    """
    async with AsyncSessionLocal() as session:
        try:
            if not session.in_transaction():
                await session.begin()
            await session.execute(text("SET LOCAL ROLE app_worker;"))
            if user_id:
                await session.execute(
                    text("SELECT set_config('app.user_id', :uid, true);"),
                    {"uid": str(user_id)}
                )
            yield session
            if session.in_transaction():
                await session.commit()
        except Exception as e:
            if session.in_transaction():
                await session.rollback()
            logger.error(f"Error in scoped_worker_session: {e}")
            raise
        finally:
            await session.close()

