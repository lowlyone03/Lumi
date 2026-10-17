import uuid
from datetime import datetime, date
from typing import Optional, List
from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
    BigInteger,
    Boolean,
    DateTime,
    Date,
    ForeignKey,
    Enum,
    UniqueConstraint,
    ARRAY,
    Float,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.models.base import Base

# Các kiểu Enum CSDL trong schema 'app'
ConversationScopeEnum = Enum(
    'single_source', 'multi_source', 'course', 'lesson',
    name='conversation_scope', schema='app'
)

ExplainStyleEnum = Enum(
    'easy', 'deep', 'concise', 'example',
    name='explain_style', schema='app'
)

MessageRoleEnum = Enum(
    'user', 'assistant',
    name='message_role', schema='app'
)

MessageIntentEnum = Enum(
    'ask', 'explain_selection', 'summarize', 'glossary',
    'compare', 'example', 'step_hint', 'self_explain_feedback',
    name='message_intent', schema='app'
)

MessageStatusEnum = Enum(
    'pending', 'streaming', 'completed', 'failed',
    name='message_status', schema='app'
)

SourceSufficiencyEnum = Enum(
    'sufficient', 'partial', 'insufficient', 'conflicting',
    name='source_sufficiency', schema='app'
)

AssessedByEnum = Enum(
    'ai', 'backend_rule', 'reviewer',
    name='assessed_by', schema='app'
)

CitationValidationEnum = Enum(
    'pending', 'valid', 'invalid',
    name='citation_validation', schema='app'
)

CitationSupportEnum = Enum(
    'unchecked', 'supported', 'partial', 'unsupported',
    name='citation_support', schema='app'
)

RetrievalMethodEnum = Enum(
    'vector', 'keyword', 'hybrid',
    name='retrieval_method', schema='app'
)

AIFeatureEnum = Enum(
    'chat', 'explain', 'summary', 'curriculum',
    'quiz_gen', 'flashcard_gen', 'outline_check', 'ingestion',
    name='ai_feature', schema='app'
)

AIRequestStatusEnum = Enum(
    'reserved', 'running', 'committed', 'released', 'failed',
    name='ai_request_status', schema='app'
)


class Conversation(Base):
    """Bảng app.conversations: Phiên hội thoại hỏi đáp của sinh viên với trợ giảng Lumi"""
    __tablename__ = "conversations"
    __table_args__ = {"schema": "app"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("app.profiles.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(250), nullable=False, default="Cuộc trò chuyện mới")
    scope_type = Column(ConversationScopeEnum, nullable=False, default="single_source")
    course_id = Column(UUID(as_uuid=True), nullable=True)
    lesson_id = Column(UUID(as_uuid=True), nullable=True)
    explain_style = Column(ExplainStyleEnum, nullable=True)
    last_message_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    conversation_sources = relationship("ConversationSource", back_populates="conversation", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at.asc()")


class ConversationSource(Base):
    """Bảng app.conversation_sources: Liên kết tài liệu được chọn vào phạm vi hội thoại"""
    __tablename__ = "conversation_sources"
    __table_args__ = (
        UniqueConstraint("conversation_id", "source_id", name="pk_conversation_sources"),
        {"schema": "app"}
    )

    conversation_id = Column(UUID(as_uuid=True), ForeignKey("app.conversations.id", ondelete="CASCADE"), primary_key=True)
    source_id = Column(UUID(as_uuid=True), ForeignKey("app.sources.id", ondelete="CASCADE"), primary_key=True)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    added_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="conversation_sources")
    source = relationship("Source")


class Message(Base):
    """Bảng app.messages: Lịch sử tin nhắn sinh viên và câu trả lời trợ giảng Lumi"""
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="uq_messages_id_owner"),
        UniqueConstraint("id", "conversation_id", "owner_id", name="uq_messages_id_conv_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("app.conversations.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    role = Column(MessageRoleEnum, nullable=False)
    intent = Column(MessageIntentEnum, nullable=False, default="ask")
    content = Column(Text, nullable=False)
    context = Column(JSONB, nullable=False, default=dict)
    status = Column(MessageStatusEnum, nullable=False, default="completed")
    source_sufficiency = Column(SourceSufficiencyEnum, nullable=True)
    sufficiency_assessed_by = Column(AssessedByEnum, nullable=True)
    uses_external_knowledge = Column(Boolean, nullable=False, default=False)
    model = Column(String, nullable=True)
    prompt_version = Column(String, nullable=True)
    ai_request_id = Column(UUID(as_uuid=True), nullable=True)
    error_code = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="messages")
    citations = relationship("MessageCitation", back_populates="message", cascade="all, delete-orphan", order_by="MessageCitation.ordinal.asc()")
    retrieval_log = relationship("RetrievalLog", back_populates="message", uselist=False, cascade="all, delete-orphan")


class MessageCitation(Base):
    """Bảng app.message_citations: Trích dẫn chính xác định vị tới chunk trong tài liệu"""
    __tablename__ = "message_citations"
    __table_args__ = (
        UniqueConstraint("message_id", "ordinal", name="uq_citations_message_ordinal"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id = Column(UUID(as_uuid=True), ForeignKey("app.messages.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    ordinal = Column(Integer, nullable=False)
    chunk_id = Column(UUID(as_uuid=True), ForeignKey("app.source_chunks.id", ondelete="SET NULL"), nullable=True)
    source_id = Column(UUID(as_uuid=True), nullable=True)
    source_version_id = Column(UUID(as_uuid=True), nullable=True)
    locator_snapshot = Column(JSONB, nullable=False)
    quote = Column(Text, nullable=True)
    validation_status = Column(CitationValidationEnum, nullable=False, default="pending")
    support_status = Column(CitationSupportEnum, nullable=False, default="unchecked")
    support_assessed_by = Column(AssessedByEnum, nullable=True)
    support_checked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    message = relationship("Message", back_populates="citations")
    chunk = relationship("SourceChunk")


class RetrievalLog(Base):
    """Bảng app.retrieval_logs: Nhật ký RAG phục vụ đánh giá thực nghiệm luận văn"""
    __tablename__ = "retrieval_logs"
    __table_args__ = {"schema": "app"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id = Column(UUID(as_uuid=True), ForeignKey("app.messages.id", ondelete="CASCADE"), nullable=False, unique=True)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    method = Column(RetrievalMethodEnum, nullable=False)
    embedding_model_id = Column(UUID(as_uuid=True), ForeignKey("app.embedding_models.id", ondelete="SET NULL"), nullable=True)
    top_k = Column(Integer, nullable=False)
    candidate_chunk_ids = Column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    selected_chunk_ids = Column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    scores = Column(ARRAY(Float), nullable=False, default=list)
    rejected_source_ids = Column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    latency_ms = Column(Integer, nullable=False, default=0)
    config = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    message = relationship("Message", back_populates="retrieval_log")


class AIRequest(Base):
    """Bảng app.ai_requests: Quản lý giao dịch hạn mức AI (reserve & settle)"""
    __tablename__ = "ai_requests"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_ai_requests_user_idempotency"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("app.profiles.id", ondelete="CASCADE"), nullable=False)
    period_start = Column(Date, nullable=False)
    idempotency_key = Column(String(128), nullable=False)
    feature = Column(AIFeatureEnum, nullable=False)
    status = Column(AIRequestStatusEnum, nullable=False, default="reserved")
    reserved_units = Column(Integer, nullable=False, default=1)
    committed_units = Column(Integer, nullable=False, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    target_type = Column(String, nullable=True)
    target_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
