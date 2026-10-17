import logging
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update

from app.core.security import CurrentUser, get_current_user
from app.core.database import scoped_user_session
from app.models.note import Note
from app.schemas.common import APIResponse
from app.schemas.note import CreateNoteRequest, NoteResponse, UpdateNoteRequest

logger = logging.getLogger("lumi.notes_api")

router = APIRouter(prefix="/notes", tags=["Notes & Highlights"])


@router.post("", response_model=APIResponse[NoteResponse], status_code=status.HTTP_201_CREATED)
async def create_note(
    req: CreateNoteRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Tạo ghi chú đa hình (note, highlight, question, saved_answer).
    Tuân thủ chặt chẽ ràng buộc toàn vẹn chk_notes_by_kind & chk_notes_lesson_requires_course.
    """
    # 1. Kiểm tra quan hệ bài học - khóa học
    if req.lesson_id is not None and req.course_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="VALIDATION_ERROR: lesson_id yêu cầu phải có course_id tương ứng",
        )

    # 2. Kiểm tra ràng buộc theo loại ghi chú (kind)
    resolved_at = None
    note_status = None

    if req.kind == "note":
        if not req.body or not req.body.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="VALIDATION_ERROR: Ghi chú (kind='note') yêu cầu phải có nội dung body",
            )
    elif req.kind == "highlight":
        if not req.quote or not req.quote.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="VALIDATION_ERROR: Highlight yêu cầu phải có quote trích dẫn",
            )
        if not req.source_version_id or not req.locator:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="VALIDATION_ERROR: Highlight yêu cầu source_version_id và locator hợp lệ",
            )
    elif req.kind == "question":
        if not req.body or not req.body.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="VALIDATION_ERROR: Câu hỏi yêu cầu phải có nội dung body",
            )
        note_status = req.status or "open"
        if note_status == "resolved":
            resolved_at = datetime.utcnow()
    elif req.kind == "saved_answer":
        if not req.message_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="VALIDATION_ERROR: Câu trả lời lưu lại (saved_answer) yêu cầu phải có message_id",
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"VALIDATION_ERROR: Loại ghi chú '{req.kind}' không hợp lệ (hỗ trợ: note, highlight, question, saved_answer)",
        )

    # 3. Tạo bản ghi Note trong phiên scoped_user_session
    async with scoped_user_session(current_user.id) as session:
        note = Note(
            owner_id=current_user.id,
            kind=req.kind,
            title=req.title,
            body=req.body,
            quote=req.quote,
            source_id=req.source_id,
            source_version_id=req.source_version_id,
            locator=req.locator,
            course_id=req.course_id,
            lesson_id=req.lesson_id,
            message_id=req.message_id,
            status=note_status,
            resolved_at=resolved_at,
        )
        session.add(note)
        await session.commit()
        await session.refresh(note)

        res = NoteResponse(
            id=note.id,
            kind=note.kind,
            title=note.title,
            body=note.body,
            quote=note.quote,
            source_id=note.source_id,
            source_version_id=note.source_version_id,
            locator=note.locator,
            course_id=note.course_id,
            lesson_id=note.lesson_id,
            message_id=note.message_id,
            status=note.status,
            resolved_at=note.resolved_at,
            created_at=note.created_at,
            updated_at=note.updated_at,
        )
        return APIResponse(data=res)


@router.get("", response_model=APIResponse[List[NoteResponse]])
async def list_notes(
    kind: Optional[str] = Query(None, description="Lọc theo loại ghi chú"),
    source_id: Optional[UUID] = Query(None, description="Lọc theo tài liệu nguồn"),
    course_id: Optional[UUID] = Query(None, description="Lọc theo khóa học"),
    lesson_id: Optional[UUID] = Query(None, description="Lọc theo bài học"),
    status_filter: Optional[str] = Query(None, alias="status", description="Lọc theo trạng thái câu hỏi"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Danh sách ghi chú của sinh viên, hỗ trợ lọc theo loại, nguồn tài liệu hoặc khóa học.
    """
    async with scoped_user_session(current_user.id) as session:
        stmt = (
            select(Note)
            .where(Note.owner_id == current_user.id, Note.deleted_at.is_(None))
            .order_by(Note.created_at.desc())
            .limit(limit)
            .offset(offset)
        )

        if kind:
            stmt = stmt.where(Note.kind == kind)
        if source_id:
            stmt = stmt.where(Note.source_id == source_id)
        if course_id:
            stmt = stmt.where(Note.course_id == course_id)
        if lesson_id:
            stmt = stmt.where(Note.lesson_id == lesson_id)
        if status_filter:
            stmt = stmt.where(Note.status == status_filter)

        result = await session.execute(stmt)
        notes = result.scalars().all()

        return APIResponse(
            data=[
                NoteResponse(
                    id=n.id,
                    kind=n.kind,
                    title=n.title,
                    body=n.body,
                    quote=n.quote,
                    source_id=n.source_id,
                    source_version_id=n.source_version_id,
                    locator=n.locator,
                    course_id=n.course_id,
                    lesson_id=n.lesson_id,
                    message_id=n.message_id,
                    status=n.status,
                    resolved_at=n.resolved_at,
                    created_at=n.created_at,
                    updated_at=n.updated_at,
                )
                for n in notes
            ]
        )


@router.get("/{note_id}", response_model=APIResponse[NoteResponse])
async def get_note_detail(
    note_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Chi tiết một ghi chú.
    """
    async with scoped_user_session(current_user.id) as session:
        stmt = select(Note).where(
            Note.id == note_id,
            Note.owner_id == current_user.id,
            Note.deleted_at.is_(None),
        )
        result = await session.execute(stmt)
        note = result.scalar_one_or_none()

        if not note:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"NOT_FOUND: Ghi chú {note_id} không tồn tại",
            )

        return APIResponse(
            data=NoteResponse(
                id=note.id,
                kind=note.kind,
                title=note.title,
                body=note.body,
                quote=note.quote,
                source_id=note.source_id,
                source_version_id=note.source_version_id,
                locator=note.locator,
                course_id=note.course_id,
                lesson_id=note.lesson_id,
                message_id=note.message_id,
                status=note.status,
                resolved_at=note.resolved_at,
                created_at=note.created_at,
                updated_at=note.updated_at,
            )
        )


@router.put("/{note_id}", response_model=APIResponse[NoteResponse])
async def update_note(
    note_id: UUID,
    req: UpdateNoteRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Cập nhật nội dung hoặc trạng thái ghi chú.
    Tuân thủ trigger tg_sync_versioning: bắt buộc tăng revision = revision + 1.
    """
    async with scoped_user_session(current_user.id) as session:
        stmt = select(Note).where(
            Note.id == note_id,
            Note.owner_id == current_user.id,
            Note.deleted_at.is_(None),
        )
        result = await session.execute(stmt)
        note = result.scalar_one_or_none()

        if not note:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"NOT_FOUND: Ghi chú {note_id} không tồn tại",
            )

        # Chuẩn bị giá trị cập nhật
        update_values = {
            "revision": Note.revision + 1,
            "updated_at": datetime.utcnow(),
        }

        if req.title is not None:
            update_values["title"] = req.title
        if req.body is not None:
            update_values["body"] = req.body
        if req.status is not None:
            if note.kind != "question":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="VALIDATION_ERROR: Chỉ có ghi chú dạng 'question' mới có thuộc tính status",
                )
            update_values["status"] = req.status
            if req.status == "resolved":
                update_values["resolved_at"] = datetime.utcnow()
            elif req.status == "open":
                update_values["resolved_at"] = None

        upd_stmt = (
            update(Note)
            .where(Note.id == note_id, Note.owner_id == current_user.id)
            .values(**update_values)
        )
        await session.execute(upd_stmt)
        await session.commit()

        # Lấy lại bản ghi sau cập nhật
        refreshed = await session.execute(stmt)
        updated_note = refreshed.scalar_one()

        return APIResponse(
            data=NoteResponse(
                id=updated_note.id,
                kind=updated_note.kind,
                title=updated_note.title,
                body=updated_note.body,
                quote=updated_note.quote,
                source_id=updated_note.source_id,
                source_version_id=updated_note.source_version_id,
                locator=updated_note.locator,
                course_id=updated_note.course_id,
                lesson_id=updated_note.lesson_id,
                message_id=updated_note.message_id,
                status=updated_note.status,
                resolved_at=updated_note.resolved_at,
                created_at=updated_note.created_at,
                updated_at=updated_note.updated_at,
            )
        )


@router.delete("/{note_id}", response_model=APIResponse[dict])
async def delete_note(
    note_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Xóa mềm ghi chú (soft delete với deleted_at và tăng revision).
    """
    async with scoped_user_session(current_user.id) as session:
        stmt = select(Note).where(
            Note.id == note_id,
            Note.owner_id == current_user.id,
            Note.deleted_at.is_(None),
        )
        result = await session.execute(stmt)
        note = result.scalar_one_or_none()

        if not note:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"NOT_FOUND: Ghi chú {note_id} không tồn tại",
            )

        upd_stmt = (
            update(Note)
            .where(Note.id == note_id, Note.owner_id == current_user.id)
            .values(
                deleted_at=datetime.utcnow(),
                revision=Note.revision + 1,
                updated_at=datetime.utcnow(),
            )
        )
        await session.execute(upd_stmt)
        await session.commit()

        return APIResponse(data={"status": "deleted", "id": str(note_id)})
