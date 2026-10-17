from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


class CreateNoteRequest(BaseModel):
    kind: str = Field(..., description="note | highlight | question | saved_answer")
    title: Optional[str] = Field(None, max_length=250)
    body: Optional[str] = Field(None, max_length=20000, description="Nội dung ghi chú hoặc câu hỏi")
    quote: Optional[str] = Field(None, max_length=5000, description="Đoạn trích dẫn (bắt buộc với highlight)")
    source_id: Optional[UUID] = None
    source_version_id: Optional[UUID] = None
    locator: Optional[Dict[str, Any]] = None
    course_id: Optional[UUID] = None
    lesson_id: Optional[UUID] = None
    message_id: Optional[UUID] = None
    status: Optional[str] = Field(None, description="open | resolved (chỉ dành cho question)")


class UpdateNoteRequest(BaseModel):
    title: Optional[str] = Field(None, max_length=250)
    body: Optional[str] = Field(None, max_length=20000)
    status: Optional[str] = Field(None, description="open | resolved")


class NoteResponse(BaseModel):
    id: UUID
    kind: str
    title: Optional[str] = None
    body: Optional[str] = None
    quote: Optional[str] = None
    source_id: Optional[UUID] = None
    source_version_id: Optional[UUID] = None
    locator: Optional[Dict[str, Any]] = None
    course_id: Optional[UUID] = None
    lesson_id: Optional[UUID] = None
    message_id: Optional[UUID] = None
    status: Optional[str] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
