from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


class UploadIntentRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(..., min_length=1, max_length=300, description="Tiêu đề tài liệu học tập")
    kind: str = Field(default="pdf", description="Loại tài liệu: pdf, video_upload, video_link, transcript_only")
    file_name: str = Field(..., min_length=1, max_length=255, description="Tên tệp gốc kèm phần mở rộng")
    mime_type: str = Field(default="application/pdf", description="MIME type của tệp")
    size_bytes: int = Field(..., gt=0, le=104857600, description="Dung lượng tệp (tối đa 100MB cho 1 tệp PDF)")
    description: Optional[str] = Field(default=None, max_length=2000, description="Mô tả tóm tắt tài liệu")
    language: Optional[str] = Field(default="vi", max_length=16, description="Ngôn ngữ chính của tài liệu")


class UploadIntentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source_id: UUID
    version_id: UUID
    upload_url: str
    storage_path: str
    expires_in_seconds: int = 900


class UploadCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    version_id: UUID = Field(..., description="ID phiên bản tài liệu vừa upload xong")


class UploadCompleteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: UUID
    status: str
    message: str


class SourceVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    version_no: int
    status: str
    storage_path: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    content_hash: Optional[str] = None
    page_count: Optional[int] = None
    duration_ms: Optional[int] = None
    processed_at: Optional[datetime] = None
    created_at: datetime


class SourceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    kind: str
    status: str
    description: Optional[str] = None
    language: Optional[str] = None
    original_url: Optional[str] = None
    is_favorite: bool
    active_version_id: Optional[UUID] = None
    active_version: Optional[SourceVersionResponse] = None
    created_at: datetime
    updated_at: datetime


class SourceChunkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_id: UUID
    source_version_id: UUID
    chunk_index: int
    content: str
    heading: Optional[str] = None
    token_count: int
    locator: Dict[str, Any]
    created_at: datetime


class SourceStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source_id: UUID
    source_status: str
    version_id: Optional[UUID] = None
    version_status: Optional[str] = None
    page_count: Optional[int] = None
    job_id: Optional[UUID] = None
    job_status: Optional[str] = None
    job_stage: Optional[str] = None
    stats: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None


class WebIngestRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    kind: str = Field(default="pdf")
    description: Optional[str] = Field(default=None, max_length=2000)
    pdf_base64: Optional[str] = Field(default=None, description="Nội dung file PDF mã hóa Base64")
    text_content: Optional[str] = Field(default=None, description="Nội dung văn bản nếu tạo từ ghi chú/link")


class SourceUpdateRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    is_favorite: Optional[bool] = None
    description: Optional[str] = Field(None, max_length=2000)

