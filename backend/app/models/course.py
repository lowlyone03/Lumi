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
    Float,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.models.base import Base

# Các kiểu Enum trong schema 'app'
CourseStatusEnum = Enum(
    'active', 'archived',
    name='course_status', schema='app'
)

DraftStatusEnum = Enum(
    'generating', 'draft', 'applied', 'discarded', 'failed', 'stale',
    name='draft_status', schema='app'
)

EvidenceStatusEnum = Enum(
    'supported', 'partially_supported', 'missing_source',
    name='evidence_status', schema='app'
)

ContentOriginEnum = Enum(
    'ai', 'user',
    name='content_origin', schema='app'
)

LessonSourceRoleEnum = Enum(
    'primary', 'supplementary',
    name='lesson_source_role', schema='app'
)

LessonProgressStatusEnum = Enum(
    'not_started', 'in_progress', 'completed', 'needs_review',
    name='lesson_progress_status', schema='app'
)


class Course(Base):
    """Bảng app.courses: Khóa học của sinh viên"""
    __tablename__ = "courses"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="uq_courses_id_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("app.profiles.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(250), nullable=False)
    description = Column(String(3000), nullable=True)
    goal = Column(String(1000), nullable=True)
    target_date = Column(Date, nullable=True)
    status = Column(CourseStatusEnum, nullable=False, default="active")
    color = Column(String(24), nullable=True)
    curriculum_revision = Column(Integer, nullable=False, default=0)
    last_studied_at = Column(DateTime(timezone=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    course_sources = relationship("CourseSource", back_populates="course", cascade="all, delete-orphan")
    chapters = relationship("Chapter", back_populates="course", cascade="all, delete-orphan", order_by="Chapter.position.asc()")
    curriculum_drafts = relationship("CurriculumDraft", back_populates="course", cascade="all, delete-orphan")


class CourseSource(Base):
    """Bảng app.course_sources: Liên kết Khóa học <-> Học liệu nguồn"""
    __tablename__ = "course_sources"
    __table_args__ = (
        UniqueConstraint("course_id", "source_id", name="pk_course_sources"),
        {"schema": "app"}
    )

    course_id = Column(UUID(as_uuid=True), ForeignKey("app.courses.id", ondelete="CASCADE"), primary_key=True)
    source_id = Column(UUID(as_uuid=True), ForeignKey("app.sources.id", ondelete="CASCADE"), primary_key=True)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    added_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    course = relationship("Course", back_populates="course_sources")
    source = relationship("Source")


class CurriculumDraft(Base):
    """Bảng app.curriculum_drafts: Bản nháp lộ trình học tập do AI đề xuất"""
    __tablename__ = "curriculum_drafts"
    __table_args__ = {"schema": "app"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id = Column(UUID(as_uuid=True), ForeignKey("app.courses.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    base_curriculum_revision = Column(Integer, nullable=False, default=0)
    status = Column(DraftStatusEnum, nullable=False, default="generating")
    content = Column(JSONB, nullable=False, default=dict)
    model = Column(String, nullable=True)
    prompt_version = Column(String, nullable=True)
    ai_request_id = Column(UUID(as_uuid=True), nullable=True)
    applied_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    course = relationship("Course", back_populates="curriculum_drafts")


class Chapter(Base):
    """Bảng app.chapters: Chương học trong Khóa học"""
    __tablename__ = "chapters"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="uq_chapters_id_owner"),
        UniqueConstraint("id", "course_id", "owner_id", name="uq_chapters_id_course_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id = Column(UUID(as_uuid=True), ForeignKey("app.courses.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    title = Column(String(250), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    course = relationship("Course", back_populates="chapters")
    lessons = relationship("Lesson", back_populates="chapter", cascade="all, delete-orphan", order_by="Lesson.position.asc()")


class Lesson(Base):
    """Bảng app.lessons: Bài học cụ thể"""
    __tablename__ = "lessons"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="uq_lessons_id_owner"),
        UniqueConstraint("id", "course_id", "owner_id", name="uq_lessons_id_course_owner"),
        {"schema": "app"}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id = Column(UUID(as_uuid=True), nullable=False)
    chapter_id = Column(UUID(as_uuid=True), ForeignKey("app.chapters.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    title = Column(String(250), nullable=False)
    objective = Column(String(2000), nullable=True)
    position = Column(Integer, nullable=False, default=0)
    estimated_minutes = Column(Integer, nullable=True)
    evidence_status = Column(EvidenceStatusEnum, nullable=False, default="supported")
    origin = Column(ContentOriginEnum, nullable=False, default="ai")
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    chapter = relationship("Chapter", back_populates="lessons")
    lesson_sources = relationship("LessonSource", back_populates="lesson", cascade="all, delete-orphan")


class LessonSource(Base):
    """Bảng app.lesson_sources: Liên kết Bài học <-> Phiên bản học liệu nguồn"""
    __tablename__ = "lesson_sources"
    __table_args__ = {"schema": "app"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lesson_id = Column(UUID(as_uuid=True), ForeignKey("app.lessons.id", ondelete="CASCADE"), nullable=False)
    source_id = Column(UUID(as_uuid=True), nullable=False)
    source_version_id = Column(UUID(as_uuid=True), ForeignKey("app.source_versions.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    locator = Column(JSONB, nullable=True)
    role = Column(LessonSourceRoleEnum, nullable=False, default="primary")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    lesson = relationship("Lesson", back_populates="lesson_sources")


class SourceProgress(Base):
    """Bảng app.source_progress: Theo dõi vị trí đọc tài liệu gần nhất của sinh viên"""
    __tablename__ = "source_progress"
    __table_args__ = {"schema": "app"}

    owner_id = Column(UUID(as_uuid=True), ForeignKey("app.profiles.id", ondelete="CASCADE"), primary_key=True)
    source_id = Column(UUID(as_uuid=True), ForeignKey("app.sources.id", ondelete="CASCADE"), primary_key=True)
    source_version_id = Column(UUID(as_uuid=True), nullable=False)
    last_locator = Column(JSONB, nullable=True)
    last_opened_at = Column(DateTime(timezone=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class LessonProgress(Base):
    """Bảng app.lesson_progress: Tiến độ học tập từng bài học"""
    __tablename__ = "lesson_progress"
    __table_args__ = {"schema": "app"}

    owner_id = Column(UUID(as_uuid=True), ForeignKey("app.profiles.id", ondelete="CASCADE"), primary_key=True)
    lesson_id = Column(UUID(as_uuid=True), ForeignKey("app.lessons.id", ondelete="CASCADE"), primary_key=True)
    status = Column(LessonProgressStatusEnum, nullable=False, default="not_started")
    last_source_id = Column(UUID(as_uuid=True), nullable=True)
    last_source_version_id = Column(UUID(as_uuid=True), nullable=True)
    last_locator = Column(JSONB, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    change_seq = Column(BigInteger, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
