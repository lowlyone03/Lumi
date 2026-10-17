import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
    BigInteger,
    Boolean,
    DateTime,
    Numeric,
    ForeignKey,
    Enum,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.models.base import Base

# Các kiểu Enum CSDL trong schema 'app'
QuizOriginEnum = Enum(
    'ai', 'user', 'mixed',
    name='quiz_origin', schema='app'
)

QuizVersionStatusEnum = Enum(
    'generating', 'draft', 'published', 'retired', 'failed',
    name='quiz_version_status', schema='app'
)

AttemptModeEnum = Enum(
    'practice', 'timed',
    name='attempt_mode', schema='app'
)

ContentOriginEnum = Enum(
    'ai', 'manual', 'imported',
    name='content_origin', schema='app'
)

QuestionTypeEnum = Enum(
    'single_choice', 'multiple_choice', 'true_false',
    name='question_type', schema='app'
)

DifficultyLevelEnum = Enum(
    'easy', 'medium', 'hard',
    name='difficulty_level', schema='app'
)

AttemptStatusEnum = Enum(
    'in_progress', 'submitted', 'expired', 'abandoned',
    name='attempt_status', schema='app'
)

ReviewReasonEnum = Enum(
    'wrong_answer', 'unsure', 'user_added',
    name='review_reason', schema='app'
)

ReviewItemStatusEnum = Enum(
    'open', 'practicing', 'resolved',
    name='review_item_status', schema='app'
)


class Quiz(Base):
    """Bảng app.quizzes: Bộ đề trắc nghiệm"""
    __tablename__ = "quizzes"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="uq_quizzes_id_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("app.profiles.id", ondelete="CASCADE"), nullable=False)
    course_id = Column(UUID(as_uuid=True), nullable=True)
    title = Column(String(250), nullable=False)
    scope = Column(JSONB, nullable=False, default=dict)
    origin = Column(QuizOriginEnum, nullable=False, default="ai")
    active_version_id = Column(UUID(as_uuid=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    versions = relationship("QuizVersion", back_populates="quiz", cascade="all, delete-orphan", foreign_keys="QuizVersion.quiz_id")


class QuizVersion(Base):
    """Bảng app.quiz_versions: Phiên bản bộ đề (khóa cứng khi published)"""
    __tablename__ = "quiz_versions"
    __table_args__ = (
        UniqueConstraint("quiz_id", "version_no", name="uq_quiz_versions_no"),
        UniqueConstraint("id", "owner_id", name="uq_quiz_versions_id_owner"),
        UniqueConstraint("id", "quiz_id", "owner_id", name="uq_quiz_versions_id_quiz_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quiz_id = Column(UUID(as_uuid=True), ForeignKey("app.quizzes.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    version_no = Column(Integer, nullable=False, default=1)
    status = Column(QuizVersionStatusEnum, nullable=False, default="generating")
    default_mode = Column(AttemptModeEnum, nullable=False, default="practice")
    time_limit_seconds = Column(Integer, nullable=True)
    question_count = Column(Integer, nullable=False, default=0)
    difficulty_requested = Column(DifficultyLevelEnum, nullable=True)
    based_on_version_id = Column(UUID(as_uuid=True), nullable=True)
    model = Column(String, nullable=True)
    prompt_version = Column(String, nullable=True)
    generation_report = Column(JSONB, nullable=False, default=dict)
    published_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    quiz = relationship("Quiz", back_populates="versions", foreign_keys=[quiz_id])
    questions = relationship("Question", back_populates="version", cascade="all, delete-orphan", order_by="Question.position.asc()")
    attempts = relationship("QuizAttempt", back_populates="version", cascade="all, delete-orphan")


class Question(Base):
    """Bảng app.questions: Câu hỏi trắc nghiệm (không chứa đáp án)"""
    __tablename__ = "questions"
    __table_args__ = (
        UniqueConstraint("quiz_version_id", "position", name="uq_questions_ver_pos"),
        UniqueConstraint("id", "owner_id", name="uq_questions_id_owner"),
        UniqueConstraint("id", "quiz_version_id", "owner_id", name="uq_questions_id_ver_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quiz_version_id = Column(UUID(as_uuid=True), ForeignKey("app.quiz_versions.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    position = Column(Integer, nullable=False)
    type = Column(QuestionTypeEnum, nullable=False, default="single_choice")
    stem = Column(Text, nullable=False)
    options = Column(JSONB, nullable=False)
    difficulty = Column(DifficultyLevelEnum, nullable=True)
    origin = Column(ContentOriginEnum, nullable=False, default="ai")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    version = relationship("QuizVersion", back_populates="questions")
    key = relationship("QuestionKey", back_populates="question", uselist=False, cascade="all, delete-orphan")


class QuestionKey(Base):
    """Bảng app.question_keys: Đáp án đúng & lời giải (Ẩn khỏi role app_api)"""
    __tablename__ = "question_keys"
    __table_args__ = {"schema": "app"}

    question_id = Column(UUID(as_uuid=True), ForeignKey("app.questions.id", ondelete="CASCADE"), primary_key=True)
    quiz_version_id = Column(UUID(as_uuid=True), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    answer_key = Column(JSONB, nullable=False)
    explanation = Column(Text, nullable=False, default="")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    question = relationship("Question", back_populates="key")


class QuizAttempt(Base):
    """Bảng app.quiz_attempts: Lượt làm bài kiểm tra trắc nghiệm của sinh viên"""
    __tablename__ = "quiz_attempts"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="uq_quiz_attempts_id_owner"),
        UniqueConstraint("id", "quiz_version_id", "owner_id", name="uq_quiz_attempts_id_ver_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quiz_version_id = Column(UUID(as_uuid=True), ForeignKey("app.quiz_versions.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    mode = Column(AttemptModeEnum, nullable=False, default="practice")
    status = Column(AttemptStatusEnum, nullable=False, default="in_progress")
    time_limit_seconds = Column(Integer, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    deadline_at = Column(DateTime(timezone=True), nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    finalized_at = Column(DateTime(timezone=True), nullable=True)
    score = Column(Numeric(6, 2), nullable=True)
    max_score = Column(Numeric(6, 2), nullable=True)
    retry_of_attempt_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    version = relationship("QuizVersion", back_populates="attempts")
    answers = relationship("AttemptAnswer", back_populates="attempt", cascade="all, delete-orphan")


class AttemptAnswer(Base):
    """Bảng app.attempt_answers: Câu trả lời cho từng câu hỏi trong lần làm bài"""
    __tablename__ = "attempt_answers"
    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id", name="uq_attempt_answers_attempt_q"),
        UniqueConstraint("id", "owner_id", name="uq_attempt_answers_id_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    attempt_id = Column(UUID(as_uuid=True), ForeignKey("app.quiz_attempts.id", ondelete="CASCADE"), nullable=False)
    quiz_version_id = Column(UUID(as_uuid=True), nullable=False)
    question_id = Column(UUID(as_uuid=True), ForeignKey("app.questions.id", ondelete="RESTRICT"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    response = Column(JSONB, nullable=True)
    is_correct = Column(Boolean, nullable=True)
    score = Column(Numeric(6, 2), nullable=True)
    hints_used = Column(Integer, nullable=False, default=0)
    marked_unsure = Column(Boolean, nullable=False, default=False)
    saved_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    attempt = relationship("QuizAttempt", back_populates="answers")
    question = relationship("Question")


class ReviewItem(Base):
    """Bảng app.review_items: Mục cần ôn lại (sinh viên lưu câu hỏi hoặc sai khi làm bài)"""
    __tablename__ = "review_items"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="uq_review_items_id_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("app.profiles.id", ondelete="CASCADE"), nullable=False)
    course_id = Column(UUID(as_uuid=True), nullable=True)
    topic_id = Column(UUID(as_uuid=True), nullable=True)
    question_id = Column(UUID(as_uuid=True), nullable=True)
    attempt_answer_id = Column(UUID(as_uuid=True), nullable=True)
    source_id = Column(UUID(as_uuid=True), nullable=True)
    source_version_id = Column(UUID(as_uuid=True), nullable=True)
    locator = Column(JSONB(none_as_null=True), nullable=True)
    reason = Column(ReviewReasonEnum, nullable=False, default="user_added")
    personal_note = Column(String(3000), nullable=True)
    status = Column(ReviewItemStatusEnum, nullable=False, default="open")
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
