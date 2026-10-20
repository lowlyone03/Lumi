import logging
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine, AsyncSessionLocal
from app.core.exceptions import (
    StudyFlowException,
    studyflow_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.api.v1.router import api_router

# Thiết lập Logger
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("lumi.main")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
FRONTEND_SOURCE_DIR = FRONTEND_DIR / "source"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Quản lý vòng đời ứng dụng FastAPI:
    - Khởi động: Kiểm tra kết nối cơ sở dữ liệu Supabase.
    - Tắt: Đóng an toàn kết nối Pool.
    """
    logger.info("Starting Lumi AI Backend Server...")
    try:
        async with AsyncSessionLocal() as session:
            res = await session.execute(text("SELECT current_database(), current_user;"))
            row = res.fetchone()
            logger.info(f"Database connected successfully: DB='{row[0]}', User='{row[1]}'")
    except Exception as e:
        logger.error(f"FATAL: Database connection failed during startup: {e}")

    yield

    logger.info("Shutting down Lumi AI Backend Server...")
    await engine.dispose()
    logger.info("Database connection pool closed.")


def create_application() -> FastAPI:
    """Tạo và cấu hình ứng dụng FastAPI chuẩn"""
    application = FastAPI(
        title="Lumi AI Backend & Web App",
        description="Hệ thống học tập thông minh có trợ giảng AI Lumi (Khóa luận tốt nghiệp FBU)",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # Middleware CORS hỗ trợ Web, Desktop & React Native Expo
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.middleware("http")
    async def add_no_cache_for_app_assets(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/app"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

    # Đăng ký Exception Handlers toàn cục
    application.add_exception_handler(StudyFlowException, studyflow_exception_handler)
    application.add_exception_handler(HTTPException, http_exception_handler)
    application.add_exception_handler(RequestValidationError, validation_exception_handler)

    # Đăng ký API Routers
    application.include_router(api_router, prefix="/api")

    @application.get("/", tags=["Root"])
    async def root():
        return {
            "app": settings.APP_NAME,
            "version": "1.0.0",
            "environment": settings.APP_ENV,
            "web_app": "/app/",
            "design_hub": "/design/START-HERE.html",
            "docs": "/docs",
            "message": "Lumi AI Backend & Web UI is running smoothly",
        }

    @application.get("/ui", include_in_schema=False)
    async def redirect_to_ui():
        return RedirectResponse(url="/app/")

    if FRONTEND_SOURCE_DIR.exists():
        application.mount(
            "/app",
            StaticFiles(directory=str(FRONTEND_SOURCE_DIR), html=True),
            name="lumi_web_app",
        )
    if FRONTEND_DIR.exists():
        application.mount(
            "/design",
            StaticFiles(directory=str(FRONTEND_DIR), html=True),
            name="lumi_design_package",
        )

    return application


app = create_application()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=settings.DEBUG,
    )

