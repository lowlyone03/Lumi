import os
from pathlib import Path
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Đường dẫn linh hoạt tìm kiếm file .env
CURRENT_DIR = Path(__file__).resolve().parent
POSSIBLE_ENVS = [
    CURRENT_DIR.parent.parent / ".env",          # kltn/backend/.env
    CURRENT_DIR.parent.parent.parent / ".env",   # kltn/.env
    Path.cwd() / ".env"                          # current working dir .env
]
ENV_FILE = next((p for p in POSSIBLE_ENVS if p.exists()), Path(".env"))

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Ứng dụng Lumi AI
    APP_NAME: str = "Lumi AI Backend"
    APP_ENV: str = "development"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    DEBUG: bool = True
    # Danh sách origin trình duyệt được gọi API, phân tách bằng dấu phẩy.
    # Không dùng "*". Trang cùng origin không cần CORS.
    CORS_ORIGINS: str = "https://www.lumiappio.tech,https://lumiappio.tech"

    # Supabase Cloud Credentials
    SUPABASE_URL: str = Field(default="https://baenwfcstfywrbanweks.supabase.co")
    SUPABASE_ANON_KEY: str = Field(default="")
    SUPABASE_SERVICE_ROLE_KEY: str = Field(default="")
    SUPABASE_JWT_SECRET: Optional[str] = Field(
        default="test-studyflow-secret-for-cryptographic-jwt-verification-123456"
    )

    # Kết nối Database (asyncpg)
    DATABASE_URL: str = Field(default="")
    DATABASE_DIRECT_URL: Optional[str] = Field(default=None)
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_TIMEOUT_SECONDS: int = 15

    # Radox AI Gateway (OpenAI Compatible)
    RADOX_API_KEY: Optional[str] = None
    RADOX_BASE_URL: str = "https://radoxai.com/v1"
    RADOX_DEFAULT_MODEL: str = "gemini-3.6-flash"

    # AI Provider Settings
    AI_PROVIDER: str = "radoxai"
    GEMINI_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None

    # Khóa mặc định cho Embedding & RAG
    DEFAULT_EMBEDDING_PROVIDER: str = "fastembed"
    DEFAULT_EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    DEFAULT_EMBEDDING_DIM: int = 384

    @property
    def async_database_url(self) -> str:
        """
        Chuyển đổi URL sang driver asyncpg (postgresql+asyncpg://)
        Bảo đảm định dạng URL chuẩn cho SQLAlchemy 2.0 Async Engine.
        """
        raw_url = self.DATABASE_URL
        if not raw_url:
            return ""
        if raw_url.startswith("postgresql://"):
            return raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if raw_url.startswith("postgres://"):
            return raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
        return raw_url

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.lower() == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.CORS_ORIGINS.split(",") if item.strip()]

settings = Settings()
