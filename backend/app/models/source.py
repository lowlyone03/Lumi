from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID

from sqlalchemy import (
    String,
    Text,
    Boolean,
    Integer,
    BigInteger,
    DateTime,
    ForeignKey,
    PrimaryKeyConstraint,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB, ARRAY, ENUM as PG_ENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

# Các kiểu Enum PostgreSQL trong schema 'app'
SourceKindEnum = PG_ENUM(
    'pdf', 'video_upload', 'video_link', 'transcript_only',
    name='source_kind',
    schema='app',
    create_type=False,
)

SourceStatusEnum = PG_ENUM(
    'pending', 'processing', 'ready', 'failed', 'archived',
    name='source_status',
    schema='app',
    create_type=False,
)

SourceVersionStatusEnum = PG_ENUM(
    'uploading', 'uploaded', 'processing', 'ready', 'failed', 'superseded', 'deleted',
    name='source_version_status',
    schema='app',
    create_type=False,
)

JobTypeEnum = PG_ENUM(
    'ingest_pdf', 'ingest_video', 'ingest_transcript',
    'reembed', 'purge_source', 'purge_account', 'gc_storage',
    name='job_type',
    schema='app',
    create_type=False,
)

JobStatusEnum = PG_ENUM(
    'queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'canceled',
    name='job_status',
    schema='app',
    create_type=False,
)

JobStageEnum = PG_ENUM(
    'queued', 'extracting', 'chunking', 'embedding', 'validating', 'completed',
    name='job_stage',
    schema='app',
    create_type=False,
)

WarningKindEnum = PG_ENUM(
    'page_no_text', 'low_audio_quality', 'truncated', 'image_only_content', 'unsupported_content',
    name='warning_kind',
    schema='app',
    create_type=False,
)

VectorDistanceEnum = PG_ENUM(
    'cosine', 'inner_product',
    name='vector_distance',
    schema='app',
    create_type=False,
)

ModelLifecycleEnum = PG_ENUM(
    'experimental', 'active', 'retired',
    name='model_lifecycle',
    schema='app',
    create_type=False,
)


class EmbeddingModel(Base):
    __tablename__ = "embedding_models"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model_name: Mapped[str] = mapped_column(Text, nullable=False)
    dimensions: Mapped[int] = mapped_column(Integer, nullable=False)
    distance: Mapped[str] = mapped_column(VectorDistanceEnum, default="cosine")
    status: Mapped[str] = mapped_column(ModelLifecycleEnum, default="experimental")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    owner_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(SourceKindEnum, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    language: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    original_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    active_version_id: Mapped[Optional[UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(SourceStatusEnum, default="pending")
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    rights_confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    change_seq: Mapped[int] = mapped_column(BigInteger, default=1)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    versions: Mapped[List["SourceVersion"]] = relationship("SourceVersion", back_populates="source", cascade="all, delete-orphan")


class SourceVersion(Base):
    __tablename__ = "source_versions"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    source_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    owner_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, default=1)
    storage_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True, unique=True)
    mime_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    content_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    status: Mapped[str] = mapped_column(SourceVersionStatusEnum, default="uploading")
    chunking_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    source: Mapped["Source"] = relationship("Source", back_populates="versions")
    chunks: Mapped[List["SourceChunk"]] = relationship("SourceChunk", back_populates="version", cascade="all, delete-orphan")


class SourceChunk(Base):
    __tablename__ = "source_chunks"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    source_version_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("source_versions.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    owner_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    heading: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    locator: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    version: Mapped["SourceVersion"] = relationship("SourceVersion", back_populates="chunks")


class ChunkEmbedding(Base):
    __tablename__ = "chunk_embeddings"
    __table_args__ = (
        PrimaryKeyConstraint("chunk_id", "embedding_model_id"),
    )

    chunk_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("source_chunks.id", ondelete="CASCADE"))
    embedding_model_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("embedding_models.id", ondelete="RESTRICT"))
    source_version_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    owner_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    # Cột embedding dạng vector (dùng Text hoặc Custom Type khi query raw, extensions.vector)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    owner_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False)
    job_type: Mapped[str] = mapped_column(JobTypeEnum, nullable=False)
    source_id: Mapped[Optional[UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    source_version_id: Mapped[Optional[UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    payload: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(JobStatusEnum, default="queued")
    stage: Mapped[str] = mapped_column(JobStageEnum, default="queued")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    next_retry_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    locked_by: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lock_token: Mapped[Optional[UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    lease_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(Text, nullable=False)
    error_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stats: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class SourceWarning(Base):
    __tablename__ = "source_warnings"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    source_version_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("source_versions.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    owner_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False)
    warning_kind: Mapped[str] = mapped_column(WarningKindEnum, nullable=False)
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    details: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
