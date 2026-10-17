from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime, time
from decimal import Decimal
from pydantic import BaseModel, Field, ConfigDict

class ProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: Optional[str] = None
    display_name: str
    avatar_url: Optional[str] = None
    field_of_study: Optional[str] = None
    education_level: Optional[str] = None
    interested_subjects: List[str] = Field(default_factory=list)
    self_declared_level: Optional[str] = None
    role: str
    status: str
    created_at: datetime
    updated_at: datetime


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(None, max_length=120)
    avatar_url: Optional[str] = None
    field_of_study: Optional[str] = Field(None, max_length=120)
    education_level: Optional[str] = Field(None, max_length=80)
    interested_subjects: Optional[List[str]] = None
    self_declared_level: Optional[str] = Field(None, pattern="^(beginner|intermediate|advanced)$")


class VisibleToolsSchema(BaseModel):
    goals: bool = False
    planner: bool = False
    reminders: bool = False
    flashcards: bool = False
    focus_timer: bool = False
    detailed_report: bool = False


class PreferencesResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    ai_explain_style: str
    allow_external_knowledge: bool
    ui_theme: str
    font_scale: float
    locale: str
    timezone: str
    visible_tools: Dict[str, bool]
    quiet_hours_start: Optional[time] = None
    quiet_hours_end: Optional[time] = None
    revision: int


class PreferencesUpdateRequest(BaseModel):
    ai_explain_style: Optional[str] = Field(None, pattern="^(easy|deep|concise|example)$")
    allow_external_knowledge: Optional[bool] = None
    ui_theme: Optional[str] = Field(None, pattern="^(system|light|dark)$")
    font_scale: Optional[float] = Field(None, ge=0.8, le=2.0)
    locale: Optional[str] = Field(None, min_length=2, max_length=10)
    timezone: Optional[str] = Field(None, max_length=64)
    visible_tools: Optional[Dict[str, bool]] = None
    quiet_hours_start: Optional[time] = None
    quiet_hours_end: Optional[time] = None
    expected_revision: int = Field(..., description="Chống xung đột ghi đè dữ liệu đồng bộ (Optimistic concurrency)")


class StorageQuotaResponse(BaseModel):
    storage_used_bytes: int
    storage_limit_bytes: int
    storage_percent: float
    ai_units_used: int
    ai_units_limit: int
    period_end: Optional[str] = None


class WebLoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    display_name: Optional[str] = Field(None, max_length=120)
    password: Optional[str] = None


class WebLoginResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    user: ProfileResponse

