import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
    BigInteger,
    SmallInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Enum,
    UniqueConstraint,
    Numeric,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.models.base import Base

# Enums trong schema 'app'
FlashcardOriginEnum = Enum(
    'ai', 'user', 'from_review_item',
    name='flashcard_origin', schema='app'
)

FlashcardStatusEnum = Enum(
    'draft', 'active', 'suspended',
    name='flashcard_status', schema='app'
)

CardScheduleStateEnum = Enum(
    'new', 'learning', 'review', 'relearning',
    name='card_schedule_state', schema='app'
)

ReviewReasonEnum = Enum(
    'wrong_answer', 'unsure', 'user_added',
    name='review_reason', schema='app'
)

ReviewItemStatusEnum = Enum(
    'open', 'practicing', 'resolved',
    name='review_item_status', schema='app'
)


class FlashcardDeck(Base):
    """
    Bảng app.flashcard_decks: Quản lý bộ thẻ ghi nhớ (có thể gắn với course hoặc độc lập)
    """
    __tablename__ = "flashcard_decks"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="flashcard_decks_id_owner_id_key"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    course_id = Column(UUID(as_uuid=True), nullable=True)
    title = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    schedule_enabled = Column(Boolean, nullable=False, default=False)
    schedule_paused_at = Column(DateTime(timezone=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    cards = relationship("Flashcard", back_populates="deck", cascade="all, delete-orphan")


class Flashcard(Base):
    """
    Bảng app.flashcards: Thẻ ghi nhớ Front/Back kèm nguồn trích dẫn
    """
    __tablename__ = "flashcards"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="flashcards_id_owner_id_key"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    deck_id = Column(UUID(as_uuid=True), ForeignKey("app.flashcard_decks.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    front = Column(Text, nullable=False)
    back = Column(Text, nullable=False)
    source_id = Column(UUID(as_uuid=True), nullable=True)
    source_version_id = Column(UUID(as_uuid=True), nullable=True)
    chunk_id = Column(UUID(as_uuid=True), nullable=True)
    locator = Column(JSONB(none_as_null=True), nullable=True)
    origin = Column(FlashcardOriginEnum, nullable=False, default='ai')
    status = Column(FlashcardStatusEnum, nullable=False, default='active')
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    deck = relationship("FlashcardDeck", back_populates="cards")
    schedule = relationship("CardSchedule", back_populates="card", uselist=False, cascade="all, delete-orphan")
    reviews = relationship("CardReview", back_populates="card", cascade="all, delete-orphan")


class CardSchedule(Base):
    """
    Bảng app.card_schedules: Lịch ôn tập theo thuật toán SM-2 (3 nút)
    """
    __tablename__ = "card_schedules"
    __table_args__ = (
        {"schema": "app"}
    )

    card_id = Column(UUID(as_uuid=True), ForeignKey("app.flashcards.id", ondelete="CASCADE"), primary_key=True)
    owner_id = Column(UUID(as_uuid=True), primary_key=True)
    state = Column(CardScheduleStateEnum, nullable=False, default='new')
    due_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    interval_days = Column(Integer, nullable=False, default=0)
    repetitions = Column(Integer, nullable=False, default=0)
    ease_factor = Column(Numeric(4, 2), nullable=False, default=2.50)
    lapses = Column(Integer, nullable=False, default=0)
    algorithm_version = Column(Text, nullable=False, default='sm2-3btn-v1')
    last_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    card = relationship("Flashcard", back_populates="schedule")


class CardReview(Base):
    """
    Bảng app.card_reviews: Nhật ký lịch sử mỗi lần lật thẻ và đánh giá rating
    """
    __tablename__ = "card_reviews"
    __table_args__ = (
        UniqueConstraint("owner_id", "event_id", name="card_reviews_owner_id_event_id_key"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), nullable=False)
    card_id = Column(UUID(as_uuid=True), ForeignKey("app.flashcards.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    rating = Column(SmallInteger, nullable=False)  # 1: Khó, 2: Vừa, 3: Dễ
    reviewed_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    prev_state = Column(JSONB, nullable=False)
    next_state = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    card = relationship("Flashcard", back_populates="reviews")


# Re-export ReviewItem from quiz.py
from app.models.quiz import ReviewItem
