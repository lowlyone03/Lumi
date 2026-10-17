from datetime import datetime
from typing import List, Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


class GenerateQuizRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=250, description="Tiêu đề bài trắc nghiệm")
    course_id: Optional[UUID] = None
    source_ids: List[UUID] = Field(..., min_length=1, description="Các tài liệu nguồn làm căn cứ sinh câu hỏi")
    question_count: Optional[int] = Field(5, ge=1, le=20, description="Số lượng câu hỏi cần sinh")
    difficulty: Optional[str] = Field("medium", description="easy | medium | hard")
    mode: Optional[str] = Field("practice", description="practice | timed")
    time_limit_seconds: Optional[int] = Field(None, description="Thời gian làm bài tính bằng giây (bắt buộc nếu timed)")


class QuestionResponse(BaseModel):
    id: UUID
    position: int
    type: str
    stem: str
    options: List[Dict[str, Any]]
    difficulty: Optional[str] = None


class QuizVersionResponse(BaseModel):
    id: UUID
    quiz_id: UUID
    version_no: int
    status: str
    default_mode: str
    time_limit_seconds: Optional[int] = None
    question_count: int
    difficulty_requested: Optional[str] = None
    published_at: Optional[datetime] = None
    questions: List[QuestionResponse] = []


class QuizResponse(BaseModel):
    id: UUID
    title: str
    course_id: Optional[UUID] = None
    origin: str
    active_version_id: Optional[UUID] = None
    created_at: datetime


class StartQuizAttemptResponse(BaseModel):
    attempt_id: UUID
    quiz_version_id: UUID
    mode: str
    status: str
    time_limit_seconds: Optional[int] = None
    started_at: datetime
    deadline_at: Optional[datetime] = None


class SaveAnswerRequest(BaseModel):
    question_id: UUID
    selected_key: str = Field(..., description="Khóa đáp án chọn (vd: 'A', 'B', 'C', 'D')")


class SubmitQuizAttemptResponse(BaseModel):
    attempt_id: UUID
    status: str
    score: Optional[float] = None
    max_score: Optional[float] = None
    submitted_at: Optional[datetime] = None
    finalized_at: Optional[datetime] = None
    percentage: Optional[float] = None
