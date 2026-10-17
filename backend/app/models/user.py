from datetime import datetime, date, time
from typing import Optional, List, Dict, Any
from uuid import UUID
from decimal import Decimal

from sqlalchemy import (
    String,
    Text,
    Boolean,
    Integer,
    BigInteger,
    Numeric,
    DateTime,
    Date,
    Time,
    ForeignKey,
    PrimaryKeyConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB, ARRAY, ENUM as PG_ENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

SelfLevelEnum = PG_ENUM(
    'beginner', 'intermediate', 'advanced',
    name='self_level',
    schema='app',
    create_type=False,
)

UserRoleEnum = PG_ENUM(
    'learner', 'admin',
    name='user_role',
    schema='app',
    create_type=False,
)

AccountStatusEnum = PG_ENUM(
    'active', 'suspended', 'pending_deletion',
    name='account_status',
    schema='app',
    create_type=False,
)

ExplainStyleEnum = PG_ENUM(
    'easy', 'deep', 'concise', 'example',
    name='explain_style',
    schema='app',
    create_type=False,
)

UIThemeEnum = PG_ENUM(
    'system', 'light', 'dark',
    name='ui_theme',
    schema='app',
    create_type=False,
)


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    display_name: Mapped[str] = mapped_column(Text, default="")
    avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    field_of_study: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    education_level: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    interested_subjects: Mapped[List[str]] = mapped_column(ARRAY(Text), default=list)
    self_declared_level: Mapped[Optional[str]] = mapped_column(SelfLevelEnum, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    # Quan hệ 1-1
    access: Mapped[Optional["UserAccess"]] = relationship(
        "UserAccess",
        back_populates="profile",
        uselist=False,
        foreign_keys="UserAccess.user_id",
    )
    preferences: Mapped[Optional["UserPreferences"]] = relationship("UserPreferences", back_populates="profile", uselist=False)
    storage: Mapped[Optional["StorageUsage"]] = relationship("StorageUsage", back_populates="profile", uselist=False)


class UserAccess(Base):
    __tablename__ = "user_access"

    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(UserRoleEnum, default="learner")
    status: Mapped[str] = mapped_column(AccountStatusEnum, default="active")
    status_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    changed_by: Mapped[Optional[UUID]] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    profile: Mapped["Profile"] = relationship("Profile", back_populates="access", foreign_keys=[user_id])


class UserPreferences(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    ai_explain_style: Mapped[str] = mapped_column(ExplainStyleEnum, default="easy")
    allow_external_knowledge: Mapped[bool] = mapped_column(Boolean, default=False)
    ui_theme: Mapped[str] = mapped_column(UIThemeEnum, default="system")
    font_scale: Mapped[Decimal] = mapped_column(Numeric(3, 2), default=Decimal("1.00"))
    locale: Mapped[str] = mapped_column(Text, default="vi")
    timezone: Mapped[str] = mapped_column(Text, default="Asia/Ho_Chi_Minh")
    visible_tools: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=lambda: {
        "goals": False,
        "planner": False,
        "reminders": False,
        "flashcards": False,
        "focus_timer": False,
        "detailed_report": False
    })
    quiet_hours_start: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    quiet_hours_end: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    change_seq: Mapped[int] = mapped_column(BigInteger, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    profile: Mapped["Profile"] = relationship("Profile", back_populates="preferences")


class StorageUsage(Base):
    __tablename__ = "storage_usage"

    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    limit_bytes: Mapped[int] = mapped_column(BigInteger, default=524288000)
    used_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    reserved_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    reconciled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    profile: Mapped["Profile"] = relationship("Profile", back_populates="storage")


class QuotaPeriod(Base):
    __tablename__ = "quota_periods"
    __table_args__ = (
        PrimaryKeyConstraint("user_id", "period_start"),
    )

    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    ai_unit_limit: Mapped[int] = mapped_column(Integer, default=200)
    ai_unit_used: Mapped[int] = mapped_column(Integer, default=0)
    ai_unit_reserved: Mapped[int] = mapped_column(Integer, default=0)
    embedding_token_limit: Mapped[int] = mapped_column(BigInteger, default=1000000)
    embedding_token_used: Mapped[int] = mapped_column(BigInteger, default=0)
    transcription_minutes_limit: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("120.00"))
    transcription_minutes_used: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0.00"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
