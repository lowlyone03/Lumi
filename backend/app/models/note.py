import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
    BigInteger,
    DateTime,
    ForeignKey,
    Enum,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.models.base import Base

# Các kiểu Enum trong schema 'app'
NoteKindEnum = Enum(
    'note', 'highlight', 'question', 'saved_answer',
    name='note_kind', schema='app'
)

QuestionNoteStatusEnum = Enum(
    'open', 'resolved',
    name='question_note_status', schema='app'
)


class Note(Base):
    """Bảng app.notes: Ghi chú đa hình (note, highlight, question, saved_answer)"""
    __tablename__ = "notes"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="uq_notes_id_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("app.profiles.id", ondelete="CASCADE"), nullable=False)
    kind = Column(NoteKindEnum, nullable=False, default="note")
    title = Column(String(250), nullable=True)
    body = Column(Text, nullable=True)
    quote = Column(Text, nullable=True)
    source_id = Column(UUID(as_uuid=True), ForeignKey("app.sources.id", ondelete="SET NULL"), nullable=True)
    source_version_id = Column(UUID(as_uuid=True), ForeignKey("app.source_versions.id", ondelete="SET NULL"), nullable=True)
    locator = Column(JSONB(none_as_null=True), nullable=True)
    course_id = Column(UUID(as_uuid=True), ForeignKey("app.courses.id", ondelete="SET NULL"), nullable=True)
    lesson_id = Column(UUID(as_uuid=True), ForeignKey("app.lessons.id", ondelete="SET NULL"), nullable=True)
    message_id = Column(UUID(as_uuid=True), nullable=True)
    status = Column(QuestionNoteStatusEnum, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    client_updated_at = Column(DateTime(timezone=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    profile = relationship("Profile", foreign_keys=[owner_id])
    source = relationship("Source", foreign_keys=[source_id])
