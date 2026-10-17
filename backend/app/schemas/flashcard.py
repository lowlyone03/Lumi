from uuid import UUID, uuid4
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ============================================================================
# FLASHCARD DECKS
# ============================================================================

class FlashcardDeckCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=250, description="Tên bộ thẻ")
    description: Optional[str] = Field(None, max_length=2000, description="Mô tả bộ thẻ")
    course_id: Optional[UUID] = Field(None, description="Khóa học liên kết (tùy chọn)")
    schedule_enabled: bool = Field(True, description="Kích hoạt thuật toán SM-2")


class FlashcardDeckUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=250)
    description: Optional[str] = Field(None, max_length=2000)
    schedule_enabled: Optional[bool] = None


class FlashcardDeckResponse(BaseModel):
    id: UUID
    owner_id: UUID
    course_id: Optional[UUID] = None
    title: str
    description: Optional[str] = None
    schedule_enabled: bool
    schedule_paused_at: Optional[datetime] = None
    total_cards: int = 0
    due_cards: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# FLASHCARDS & SCHEDULES
# ============================================================================

class CardScheduleResponse(BaseModel):
    card_id: UUID
    state: str
    due_at: datetime
    interval_days: int
    repetitions: int
    ease_factor: float
    lapses: int
    algorithm_version: str
    last_reviewed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FlashcardCreate(BaseModel):
    front: str = Field(..., min_length=1, max_length=2000, description="Mặt trước (câu hỏi / thuật ngữ)")
    back: str = Field(..., min_length=1, max_length=5000, description="Mặt sau (đáp án / giải thích)")
    source_id: Optional[UUID] = None
    source_version_id: Optional[UUID] = None
    chunk_id: Optional[UUID] = None
    locator: Optional[Dict[str, Any]] = None
    origin: Optional[str] = Field('user', description="ai, user, from_review_item")


class FlashcardUpdate(BaseModel):
    front: Optional[str] = Field(None, min_length=1, max_length=2000)
    back: Optional[str] = Field(None, min_length=1, max_length=5000)
    status: Optional[str] = Field(None, description="active, suspended")


class FlashcardResponse(BaseModel):
    id: UUID
    deck_id: UUID
    owner_id: UUID
    front: str
    back: str
    source_id: Optional[UUID] = None
    source_version_id: Optional[UUID] = None
    chunk_id: Optional[UUID] = None
    locator: Optional[Dict[str, Any]] = None
    origin: str
    status: str
    schedule: Optional[CardScheduleResponse] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============================================================================
# AI FLASHCARD GENERATION
# ============================================================================

class GenerateFlashcardsRequest(BaseModel):
    course_id: Optional[UUID] = None
    source_id: Optional[UUID] = None
    source_version_id: Optional[UUID] = None
    lesson_id: Optional[UUID] = None
    num_cards: int = Field(5, ge=1, le=20, description="Số lượng thẻ cần sinh (1-20)")
    target_deck_id: Optional[UUID] = Field(None, description="Nếu có, tự động nạp thẻ vào bộ này")


class FlashcardDraftItem(BaseModel):
    front: str
    back: str
    source_id: Optional[UUID] = None
    source_version_id: Optional[UUID] = None
    chunk_id: Optional[UUID] = None
    locator: Optional[Dict[str, Any]] = None


class GenerateFlashcardsResponse(BaseModel):
    cards: List[FlashcardDraftItem]
    saved_to_deck_id: Optional[UUID] = None


# ============================================================================
# SM-2 SPACED REPETITION REVIEWS
# ============================================================================

class CardReviewRequest(BaseModel):
    event_id: Optional[UUID] = Field(default_factory=uuid4, description="ID biến cố chống gửi lặp")
    rating: int = Field(..., ge=1, le=3, description="Đánh giá chất lượng: 1 (Khó/Quên), 2 (Vừa), 3 (Dễ)")


class CardReviewResponse(BaseModel):
    id: UUID
    event_id: UUID
    card_id: UUID
    rating: int
    reviewed_at: datetime
    prev_state: Dict[str, Any]
    next_state: Dict[str, Any]

    class Config:
        from_attributes = True


# ============================================================================
# REVIEW ITEMS (HẠNG MỤC CẦN ÔN TẬP)
# ============================================================================

class ReviewItemCreate(BaseModel):
    course_id: Optional[UUID] = None
    question_id: Optional[UUID] = None
    attempt_answer_id: Optional[UUID] = None
    source_id: Optional[UUID] = None
    source_version_id: Optional[UUID] = None
    locator: Optional[Dict[str, Any]] = None
    reason: Optional[str] = Field('user_added', description="wrong_answer, unsure, user_added")
    personal_note: Optional[str] = Field(None, max_length=3000)


class ReviewItemResponse(BaseModel):
    id: UUID
    owner_id: UUID
    course_id: Optional[UUID] = None
    question_id: Optional[UUID] = None
    attempt_answer_id: Optional[UUID] = None
    source_id: Optional[UUID] = None
    source_version_id: Optional[UUID] = None
    locator: Optional[Dict[str, Any]] = None
    reason: str
    personal_note: Optional[str] = None
    status: str
    resolved_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ConvertReviewItemRequest(BaseModel):
    deck_id: UUID = Field(..., description="ID bộ thẻ muốn thêm vào")
    front: Optional[str] = Field(None, description="Mặt trước tùy chỉnh (nếu bỏ trống lấy câu hỏi)")
    back: Optional[str] = Field(None, description="Mặt sau tùy chỉnh (nếu bỏ trống lấy đáp án/ghi chú)")
