from datetime import datetime
from typing import List, Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


class CreateConversationRequest(BaseModel):
    title: Optional[str] = Field(None, max_length=250, description="Tiêu đề cuộc trò chuyện")
    source_ids: List[UUID] = Field(..., min_length=1, description="Danh sách tài liệu học tập đưa vào phạm vi hỏi đáp")
    scope_type: Optional[str] = Field("single_source", description="single_source | multi_source")
    explain_style: Optional[str] = Field(None, description="easy | deep | concise | example")


class ConversationSourceResponse(BaseModel):
    source_id: UUID
    title: Optional[str] = None
    added_at: datetime


class CitationResponse(BaseModel):
    ordinal: int
    chunk_id: Optional[UUID] = None
    source_id: Optional[UUID] = None
    locator: Dict[str, Any] = Field(default_factory=dict)
    quote: Optional[str] = None
    validation_status: str = "valid"


class MessageResponse(BaseModel):
    id: UUID
    conversation_id: UUID
    role: str
    intent: str
    content: str
    status: str
    source_sufficiency: Optional[str] = None
    uses_external_knowledge: bool = False
    model: Optional[str] = None
    created_at: datetime
    citations: List[CitationResponse] = []


class ConversationResponse(BaseModel):
    id: UUID
    title: str
    scope_type: str
    explain_style: Optional[str] = None
    last_message_at: datetime
    created_at: datetime
    sources: List[ConversationSourceResponse] = []


class ConversationDetailResponse(BaseModel):
    id: UUID
    title: str
    scope_type: str
    explain_style: Optional[str] = None
    last_message_at: datetime
    created_at: datetime
    sources: List[ConversationSourceResponse] = []
    messages: List[MessageResponse] = []


class SendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000, description="Nội dung câu hỏi của sinh viên")
    intent: Optional[str] = Field("ask", description="ask | explain_selection | summarize | etc.")
    source_ids: Optional[List[UUID]] = Field(None, description="Danh sách nguồn ghi đè tạm thời (nếu có)")
