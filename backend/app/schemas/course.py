from datetime import datetime, date
from typing import List, Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


class CreateCourseRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=250, description="Tên khóa học")
    description: Optional[str] = Field(None, max_length=3000, description="Mô tả khóa học")
    goal: Optional[str] = Field(None, max_length=1000, description="Mục tiêu học tập")
    target_date: Optional[date] = Field(None, description="Ngày dự kiến hoàn thành (tùy chọn)")
    color: Optional[str] = Field(None, max_length=24, description="Mã màu thẻ khóa học (vd: #4F46E5)")
    source_ids: Optional[List[UUID]] = Field(default_factory=list, description="Danh sách tài liệu học liệu liên kết")


class LessonResponse(BaseModel):
    id: UUID
    chapter_id: UUID
    course_id: UUID
    title: str
    objective: Optional[str] = None
    position: int
    estimated_minutes: Optional[int] = None
    evidence_status: str
    origin: str


class ChapterResponse(BaseModel):
    id: UUID
    course_id: UUID
    title: str
    position: int
    lessons: List[LessonResponse] = []


class CourseResponse(BaseModel):
    id: UUID
    title: str
    description: Optional[str] = None
    goal: Optional[str] = None
    target_date: Optional[date] = None
    status: str
    color: Optional[str] = None
    curriculum_revision: int
    last_studied_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class CourseDetailResponse(CourseResponse):
    source_ids: List[UUID] = []
    chapters: List[ChapterResponse] = []


class GenerateCurriculumDraftRequest(BaseModel):
    source_ids: List[UUID] = Field(..., min_length=1, description="Các tài liệu nguồn để AI phân tích đề cương")
    target_weeks: Optional[int] = Field(4, ge=1, le=24, description="Số tuần học dự kiến")
    hours_per_week: Optional[int] = Field(5, ge=1, le=40, description="Số giờ tự học mỗi tuần")


class CurriculumDraftResponse(BaseModel):
    id: UUID
    course_id: UUID
    status: str
    content: Dict[str, Any]
    model: Optional[str] = None
    created_at: datetime


class UpdateSourceProgressRequest(BaseModel):
    source_version_id: UUID
    last_locator: Optional[Dict[str, Any]] = None


class SourceProgressResponse(BaseModel):
    source_id: UUID
    source_version_id: UUID
    last_locator: Optional[Dict[str, Any]] = None
    last_opened_at: Optional[datetime] = None
    updated_at: datetime


class UpdateLessonProgressRequest(BaseModel):
    status: str = Field(..., description="not_started | in_progress | completed | needs_review")
    last_source_id: Optional[UUID] = None
    last_source_version_id: Optional[UUID] = None
    last_locator: Optional[Dict[str, Any]] = None


class LessonProgressResponse(BaseModel):
    lesson_id: UUID
    status: str
    last_locator: Optional[Dict[str, Any]] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    updated_at: datetime
