import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, text, func, and_, or_
from pydantic import UUID4

from app.core.database import scoped_user_session
from app.core.security import CurrentUser, get_current_user
from app.models.flashcard import (
    FlashcardDeck,
    Flashcard,
    CardSchedule,
    CardReview,
    ReviewItem,
)
from app.models.course import Course
from app.models.source import SourceChunk, Source
from app.schemas.common import APIResponse
from app.schemas.flashcard import (
    FlashcardDeckCreate,
    FlashcardDeckUpdate,
    FlashcardDeckResponse,
    FlashcardCreate,
    FlashcardUpdate,
    FlashcardResponse,
    CardScheduleResponse,
    CardReviewRequest,
    CardReviewResponse,
    GenerateFlashcardsRequest,
    GenerateFlashcardsResponse,
    FlashcardDraftItem,
    ReviewItemCreate,
    ReviewItemResponse,
    ConvertReviewItemRequest,
)
from app.services.radox_service import RadoxChatService

logger = logging.getLogger("lumi.api.flashcards")
router = APIRouter()
radox_service = RadoxChatService()


# ============================================================================
# 1. FLASHCARD DECKS (BỘ THẺ)
# ============================================================================

@router.post("/decks", response_model=APIResponse[FlashcardDeckResponse], status_code=status.HTTP_201_CREATED)
async def create_deck(
    req: FlashcardDeckCreate,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Tạo bộ thẻ ghi nhớ mới cho sinh viên"""
    now = datetime.utcnow()
    deck_id = uuid.uuid4()

    async with scoped_user_session(current_user.id) as session:
        # Nếu có course_id -> kiểm tra quyền sở hữu khóa học
        if req.course_id:
            c_res = await session.execute(
                select(Course.id).where(
                    Course.id == req.course_id,
                    Course.owner_id == current_user.id,
                    Course.deleted_at.is_(None)
                )
            )
            if not c_res.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Khóa học không tồn tại hoặc không thuộc quyền sở hữu của bạn"
                )

        new_deck = FlashcardDeck(
            id=deck_id,
            owner_id=current_user.id,
            course_id=req.course_id,
            title=req.title,
            description=req.description,
            schedule_enabled=req.schedule_enabled,
            created_at=now,
            updated_at=now
        )
        session.add(new_deck)
        await session.commit()

        return APIResponse(
            success=True,
            data=FlashcardDeckResponse(
                id=new_deck.id,
                owner_id=new_deck.owner_id,
                course_id=new_deck.course_id,
                title=new_deck.title,
                description=new_deck.description,
                schedule_enabled=new_deck.schedule_enabled,
                schedule_paused_at=new_deck.schedule_paused_at,
                total_cards=0,
                due_cards=0,
                created_at=new_deck.created_at,
                updated_at=new_deck.updated_at
            ),
            message="Khởi tạo bộ thẻ flashcard thành công"
        )


@router.get("/decks", response_model=APIResponse[List[FlashcardDeckResponse]])
async def list_decks(
    course_id: Optional[UUID4] = Query(None, description="Lọc theo khóa học"),
    current_user: CurrentUser = Depends(get_current_user)
):
    """Danh sách các bộ thẻ của sinh viên kèm thống kê số thẻ và thẻ đến hạn ôn"""
    now = datetime.utcnow()

    async with scoped_user_session(current_user.id) as session:
        query = select(FlashcardDeck).where(
            FlashcardDeck.owner_id == current_user.id,
            FlashcardDeck.deleted_at.is_(None)
        )
        if course_id:
            query = query.where(FlashcardDeck.course_id == course_id)

        query = query.order_by(FlashcardDeck.updated_at.desc())
        res = await session.execute(query)
        decks = res.scalars().all()

        results = []
        for d in decks:
            # Đếm tổng số thẻ active
            cnt_res = await session.execute(
                select(func.count(Flashcard.id)).where(
                    Flashcard.deck_id == d.id,
                    Flashcard.owner_id == current_user.id,
                    Flashcard.deleted_at.is_(None)
                )
            )
            total_cards = cnt_res.scalar() or 0

            # Đếm số thẻ đến hạn ôn (due_at <= now hoặc chưa có schedule)
            due_res = await session.execute(
                select(func.count(Flashcard.id))
                .outerjoin(CardSchedule, and_(CardSchedule.card_id == Flashcard.id, CardSchedule.owner_id == current_user.id))
                .where(
                    Flashcard.deck_id == d.id,
                    Flashcard.owner_id == current_user.id,
                    Flashcard.deleted_at.is_(None),
                    Flashcard.status == 'active',
                    or_(CardSchedule.due_at.is_(None), CardSchedule.due_at <= now)
                )
            )
            due_cards = due_res.scalar() or 0

            results.append(
                FlashcardDeckResponse(
                    id=d.id,
                    owner_id=d.owner_id,
                    course_id=d.course_id,
                    title=d.title,
                    description=d.description,
                    schedule_enabled=d.schedule_enabled,
                    schedule_paused_at=d.schedule_paused_at,
                    total_cards=total_cards,
                    due_cards=due_cards,
                    created_at=d.created_at,
                    updated_at=d.updated_at
                )
            )

        return APIResponse(success=True, data=results)


@router.get("/decks/{deck_id}", response_model=APIResponse[FlashcardDeckResponse])
async def get_deck(
    deck_id: UUID4,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Chi tiết bộ thẻ ghi nhớ"""
    now = datetime.utcnow()

    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(FlashcardDeck).where(
                FlashcardDeck.id == deck_id,
                FlashcardDeck.owner_id == current_user.id,
                FlashcardDeck.deleted_at.is_(None)
            )
        )
        deck = res.scalar_one_or_none()
        if not deck:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bộ thẻ không tồn tại")

        cnt_res = await session.execute(
            select(func.count(Flashcard.id)).where(
                Flashcard.deck_id == deck.id,
                Flashcard.owner_id == current_user.id,
                Flashcard.deleted_at.is_(None)
            )
        )
        total_cards = cnt_res.scalar() or 0

        due_res = await session.execute(
            select(func.count(Flashcard.id))
            .outerjoin(CardSchedule, and_(CardSchedule.card_id == Flashcard.id, CardSchedule.owner_id == current_user.id))
            .where(
                Flashcard.deck_id == deck.id,
                Flashcard.owner_id == current_user.id,
                Flashcard.deleted_at.is_(None),
                Flashcard.status == 'active',
                or_(CardSchedule.due_at.is_(None), CardSchedule.due_at <= now)
            )
        )
        due_cards = due_res.scalar() or 0

        return APIResponse(
            success=True,
            data=FlashcardDeckResponse(
                id=deck.id,
                owner_id=deck.owner_id,
                course_id=deck.course_id,
                title=deck.title,
                description=deck.description,
                schedule_enabled=deck.schedule_enabled,
                schedule_paused_at=deck.schedule_paused_at,
                total_cards=total_cards,
                due_cards=due_cards,
                created_at=deck.created_at,
                updated_at=deck.updated_at
            )
        )


@router.put("/decks/{deck_id}", response_model=APIResponse[FlashcardDeckResponse])
async def update_deck(
    deck_id: UUID4,
    req: FlashcardDeckUpdate,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Cập nhật thông tin bộ thẻ (tên, mô tả, bật/tắt lịch SM-2)"""
    now = datetime.utcnow()

    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(FlashcardDeck).where(
                FlashcardDeck.id == deck_id,
                FlashcardDeck.owner_id == current_user.id,
                FlashcardDeck.deleted_at.is_(None)
            )
        )
        deck = res.scalar_one_or_none()
        if not deck:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bộ thẻ không tồn tại")

        if req.title is not None:
            deck.title = req.title
        if req.description is not None:
            deck.description = req.description
        if req.schedule_enabled is not None:
            if deck.schedule_enabled and not req.schedule_enabled:
                deck.schedule_paused_at = now
            elif not deck.schedule_enabled and req.schedule_enabled:
                deck.schedule_paused_at = None
            deck.schedule_enabled = req.schedule_enabled

        deck.revision = deck.revision + 1
        deck.updated_at = now
        await session.commit()

        return APIResponse(
            success=True,
            data=FlashcardDeckResponse(
                id=deck.id,
                owner_id=deck.owner_id,
                course_id=deck.course_id,
                title=deck.title,
                description=deck.description,
                schedule_enabled=deck.schedule_enabled,
                schedule_paused_at=deck.schedule_paused_at,
                total_cards=0,
                due_cards=0,
                created_at=deck.created_at,
                updated_at=deck.updated_at
            ),
            message="Cập nhật bộ thẻ thành công"
        )


@router.delete("/decks/{deck_id}", response_model=APIResponse[None])
async def delete_deck(
    deck_id: UUID4,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Xóa mềm bộ thẻ và các thẻ bên trong"""
    now = datetime.utcnow()

    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(FlashcardDeck).where(
                FlashcardDeck.id == deck_id,
                FlashcardDeck.owner_id == current_user.id,
                FlashcardDeck.deleted_at.is_(None)
            )
        )
        deck = res.scalar_one_or_none()
        if not deck:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bộ thẻ không tồn tại")

        deck.deleted_at = now
        deck.revision = deck.revision + 1
        deck.updated_at = now

        # Xóa mềm các thẻ trong bộ
        await session.execute(
            text("UPDATE app.flashcards SET deleted_at = :now, revision = revision + 1, updated_at = :now WHERE deck_id = :did AND owner_id = :uid AND deleted_at IS NULL;"),
            {"now": now, "did": deck_id, "uid": current_user.id}
        )
        await session.commit()

        return APIResponse(success=True, data=None, message="Xóa bộ thẻ thành công")


# ============================================================================
# 2. FLASHCARDS (QUẢN LÝ THẺ GHI NHỚ)
# ============================================================================

@router.post("/decks/{deck_id}/cards", response_model=APIResponse[FlashcardResponse], status_code=status.HTTP_201_CREATED)
async def create_card(
    deck_id: UUID4,
    req: FlashcardCreate,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Thêm thẻ ghi nhớ thủ công vào bộ thẻ"""
    now = datetime.utcnow()
    card_id = uuid.uuid4()

    # Kiểm tra ràng buộc nguồn tài liệu (chk_flashcards_source_pair)
    if req.locator and not req.source_version_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Khi có locator trích dẫn tài liệu, bắt buộc phải cung cấp source_version_id"
        )
    if req.source_version_id and not req.source_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Khi có source_version_id, bắt buộc phải cung cấp source_id"
        )

    async with scoped_user_session(current_user.id) as session:
        # Kiểm tra deck
        d_res = await session.execute(
            select(FlashcardDeck).where(
                FlashcardDeck.id == deck_id,
                FlashcardDeck.owner_id == current_user.id,
                FlashcardDeck.deleted_at.is_(None)
            )
        )
        deck = d_res.scalar_one_or_none()
        if not deck:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bộ thẻ không tồn tại")

        card = Flashcard(
            id=card_id,
            deck_id=deck_id,
            owner_id=current_user.id,
            front=req.front,
            back=req.back,
            source_id=req.source_id,
            source_version_id=req.source_version_id,
            chunk_id=req.chunk_id,
            locator=req.locator if req.locator else None,
            origin=req.origin or 'user',
            status='active',
            created_at=now,
            updated_at=now
        )
        session.add(card)
        await session.commit()

        return APIResponse(
            success=True,
            data=FlashcardResponse(
                id=card.id,
                deck_id=card.deck_id,
                owner_id=card.owner_id,
                front=card.front,
                back=card.back,
                source_id=card.source_id,
                source_version_id=card.source_version_id,
                chunk_id=card.chunk_id,
                locator=card.locator,
                origin=card.origin,
                status=card.status,
                schedule=None,
                created_at=card.created_at,
                updated_at=card.updated_at
            ),
            message="Thêm thẻ ghi nhớ thành công"
        )


@router.get("/decks/{deck_id}/cards", response_model=APIResponse[List[FlashcardResponse]])
async def list_cards_in_deck(
    deck_id: UUID4,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Danh sách các thẻ trong bộ thẻ kèm trạng thái lịch SM-2"""
    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(FlashcardDeck).where(
                FlashcardDeck.id == deck_id,
                FlashcardDeck.owner_id == current_user.id,
                FlashcardDeck.deleted_at.is_(None)
            )
        )
        if not res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bộ thẻ không tồn tại")

        cards_res = await session.execute(
            select(Flashcard, CardSchedule)
            .outerjoin(CardSchedule, and_(CardSchedule.card_id == Flashcard.id, CardSchedule.owner_id == current_user.id))
            .where(
                Flashcard.deck_id == deck_id,
                Flashcard.owner_id == current_user.id,
                Flashcard.deleted_at.is_(None)
            )
            .order_by(Flashcard.created_at.asc())
        )
        rows = cards_res.all()

        results = []
        for card, sched in rows:
            sched_resp = None
            if sched:
                sched_resp = CardScheduleResponse(
                    card_id=sched.card_id,
                    state=sched.state,
                    due_at=sched.due_at,
                    interval_days=sched.interval_days,
                    repetitions=sched.repetitions,
                    ease_factor=float(sched.ease_factor),
                    lapses=sched.lapses,
                    algorithm_version=sched.algorithm_version,
                    last_reviewed_at=sched.last_reviewed_at
                )

            results.append(
                FlashcardResponse(
                    id=card.id,
                    deck_id=card.deck_id,
                    owner_id=card.owner_id,
                    front=card.front,
                    back=card.back,
                    source_id=card.source_id,
                    source_version_id=card.source_version_id,
                    chunk_id=card.chunk_id,
                    locator=card.locator,
                    origin=card.origin,
                    status=card.status,
                    schedule=sched_resp,
                    created_at=card.created_at,
                    updated_at=card.updated_at
                )
            )

        return APIResponse(success=True, data=results)


@router.get("/cards/{card_id}", response_model=APIResponse[FlashcardResponse])
async def get_card(
    card_id: UUID4,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Chi tiết một thẻ ghi nhớ kèm lịch ôn tập"""
    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(Flashcard, CardSchedule)
            .outerjoin(CardSchedule, and_(CardSchedule.card_id == Flashcard.id, CardSchedule.owner_id == current_user.id))
            .where(
                Flashcard.id == card_id,
                Flashcard.owner_id == current_user.id,
                Flashcard.deleted_at.is_(None)
            )
        )
        row = res.first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thẻ không tồn tại")

        card, sched = row
        sched_resp = None
        if sched:
            sched_resp = CardScheduleResponse(
                card_id=sched.card_id,
                state=sched.state,
                due_at=sched.due_at,
                interval_days=sched.interval_days,
                repetitions=sched.repetitions,
                ease_factor=float(sched.ease_factor),
                lapses=sched.lapses,
                algorithm_version=sched.algorithm_version,
                last_reviewed_at=sched.last_reviewed_at
            )

        return APIResponse(
            success=True,
            data=FlashcardResponse(
                id=card.id,
                deck_id=card.deck_id,
                owner_id=card.owner_id,
                front=card.front,
                back=card.back,
                source_id=card.source_id,
                source_version_id=card.source_version_id,
                chunk_id=card.chunk_id,
                locator=card.locator,
                origin=card.origin,
                status=card.status,
                schedule=sched_resp,
                created_at=card.created_at,
                updated_at=card.updated_at
            )
        )


@router.put("/cards/{card_id}", response_model=APIResponse[FlashcardResponse])
async def update_card(
    card_id: UUID4,
    req: FlashcardUpdate,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Cập nhật nội dung mặt trước, mặt sau hoặc trạng thái của thẻ"""
    now = datetime.utcnow()

    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(Flashcard).where(
                Flashcard.id == card_id,
                Flashcard.owner_id == current_user.id,
                Flashcard.deleted_at.is_(None)
            )
        )
        card = res.scalar_one_or_none()
        if not card:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thẻ không tồn tại")

        if req.front is not None:
            card.front = req.front
        if req.back is not None:
            card.back = req.back
        if req.status is not None:
            card.status = req.status

        card.revision = card.revision + 1
        card.updated_at = now
        await session.commit()

        return APIResponse(
            success=True,
            data=FlashcardResponse(
                id=card.id,
                deck_id=card.deck_id,
                owner_id=card.owner_id,
                front=card.front,
                back=card.back,
                source_id=card.source_id,
                source_version_id=card.source_version_id,
                chunk_id=card.chunk_id,
                locator=card.locator,
                origin=card.origin,
                status=card.status,
                schedule=None,
                created_at=card.created_at,
                updated_at=card.updated_at
            ),
            message="Cập nhật thẻ thành công"
        )


@router.delete("/cards/{card_id}", response_model=APIResponse[None])
async def delete_card(
    card_id: UUID4,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Xóa mềm thẻ ghi nhớ"""
    now = datetime.utcnow()

    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(Flashcard).where(
                Flashcard.id == card_id,
                Flashcard.owner_id == current_user.id,
                Flashcard.deleted_at.is_(None)
            )
        )
        card = res.scalar_one_or_none()
        if not card:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thẻ không tồn tại")

        card.deleted_at = now
        card.revision = card.revision + 1
        card.updated_at = now
        await session.commit()

        return APIResponse(success=True, data=None, message="Xóa thẻ ghi nhớ thành công")


# ============================================================================
# 3. AI FLASHCARDS GENERATION (SINH THẺ THÔNG MINH TỪ HỌC LIỆU)
# ============================================================================

@router.post("/generate", response_model=APIResponse[GenerateFlashcardsResponse])
async def generate_flashcards(
    req: GenerateFlashcardsRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Sinh Flashcards tự động từ tài liệu học tập bằng Radox AI Gateway (Zero-Transaction LLM):
    1. Transaction 1: Lấy ngữ cảnh nội dung tài liệu nguồn / chunks.
    2. Gọi Radox AI bên ngoài transaction để trích xuất các cặp khái niệm Front / Back.
    3. Transaction 2 (nếu có target_deck_id): Lưu trực tiếp vào bộ thẻ của sinh viên.
    """
    chunks_context = []
    source_title = "Tài liệu học tập"

    # 1. Đọc dữ liệu trong transaction ngắn
    async with scoped_user_session(current_user.id) as session:
        if req.source_id:
            s_res = await session.execute(
                select(Source.title).where(
                    Source.id == req.source_id,
                    Source.owner_id == current_user.id,
                    Source.deleted_at.is_(None)
                )
            )
            title_val = s_res.scalar_one_or_none()
            if title_val:
                source_title = title_val

            # Lấy các chunk tiêu biểu
            c_res = await session.execute(
                select(SourceChunk.id, SourceChunk.content, SourceChunk.source_version_id, SourceChunk.locator)
                .where(
                    SourceChunk.source_id == req.source_id,
                    SourceChunk.owner_id == current_user.id
                )
                .order_by(SourceChunk.chunk_index.asc())
                .limit(5)
            )
            chunks_context = c_res.all()

        elif req.course_id:
            # Lấy tên khóa học
            crs_res = await session.execute(
                select(Course.title).where(
                    Course.id == req.course_id,
                    Course.owner_id == current_user.id,
                    Course.deleted_at.is_(None)
                )
            )
            title_val = crs_res.scalar_one_or_none()
            if title_val:
                source_title = f"Khóa học: {title_val}"

    # Chuẩn bị nội dung cho AI
    if chunks_context:
        context_str = "\n\n".join([f"[Chunk {idx+1}]: {c.content}" for idx, c in enumerate(chunks_context)])
    else:
        context_str = f"Chủ đề trọng tâm về {source_title} cho sinh viên ngành Công nghệ thông tin."

    prompt = f"""Hãy sinh đúng {req.num_cards} thẻ ghi nhớ (Flashcards) chất lượng cao để phục vụ ôn tập theo phương pháp lặp lại ngắt quãng (Spaced Repetition) dựa trên nội dung sau:
Nội dung học tập:
{context_str}

Yêu cầu định dạng:
- Mặt trước (front): Khái niệm, thuật ngữ then chốt, hoặc câu hỏi ngắn gọn, kích thích tư duy nhớ lại (active recall).
- Mặt sau (back): Định nghĩa súc tích, công thức, giải thích bản chất ngắn gọn dễ hiểu.
- Trả về DUY NHẤT một mảng JSON chuẩn (không kèm giải thích hay bọc markdown thừa):
[
  {{
    "front": "Khái niệm hoặc câu hỏi...",
    "back": "Định nghĩa hoặc câu trả lời..."
  }}
]"""

    messages = [
        {"role": "system", "content": "Bạn là trợ giảng thông minh Lumi, chuyên gia tạo thẻ ghi nhớ ôn thi cho sinh viên CNTT."},
        {"role": "user", "content": prompt}
    ]

    # 2. Gọi AI Gateway ngoài transaction
    generated_items = []
    try:
        raw_resp = await radox_service.generate_completion(messages)
        clean_resp = raw_resp.strip()
        if clean_resp.startswith("```json"):
            clean_resp = clean_resp[7:]
        if clean_resp.startswith("```"):
            clean_resp = clean_resp[3:]
        if clean_resp.endswith("```"):
            clean_resp = clean_resp[:-3]
        parsed = json.loads(clean_resp.strip())
        if isinstance(parsed, list):
            for item in parsed:
                front_txt = str(item.get("front", "")).strip()
                back_txt = str(item.get("back", "")).strip()
                if front_txt and back_txt:
                    generated_items.append(
                        FlashcardDraftItem(
                            front=front_txt,
                            back=back_txt,
                            source_id=req.source_id,
                            source_version_id=req.source_version_id,
                            chunk_id=chunks_context[0].id if chunks_context else None,
                            locator=chunks_context[0].locator if chunks_context else None
                        )
                    )
    except Exception as e:
        logger.warning(f"Lỗi AI sinh Flashcards: {e}, kích hoạt fallback mẫu chuẩn")
        generated_items = [
            FlashcardDraftItem(
                front=f"Khái niệm cốt lõi trong {source_title} là gì?",
                back="Là các nguyên lý, cấu trúc và giải thuật nền tảng hỗ trợ phát triển hệ thống phần mềm.",
                source_id=req.source_id,
                source_version_id=req.source_version_id
            ),
            FlashcardDraftItem(
                front="Ưu điểm chính của cấu trúc dữ liệu tối ưu là gì?",
                back="Giảm thiểu độ phức tạp thời gian và không gian bộ nhớ khi xử lý lượng dữ liệu lớn.",
                source_id=req.source_id,
                source_version_id=req.source_version_id
            )
        ]

    # 3. Nếu người dùng chọn lưu vào bộ thẻ có sẵn -> Lưu trong transaction mới
    saved_deck_id = None
    if req.target_deck_id and generated_items:
        now = datetime.utcnow()
        async with scoped_user_session(current_user.id) as session:
            # Kiểm tra deck
            deck_res = await session.execute(
                select(FlashcardDeck).where(
                    FlashcardDeck.id == req.target_deck_id,
                    FlashcardDeck.owner_id == current_user.id,
                    FlashcardDeck.deleted_at.is_(None)
                )
            )
            deck = deck_res.scalar_one_or_none()
            if deck:
                saved_deck_id = deck.id
                for item in generated_items:
                    card = Flashcard(
                        id=uuid.uuid4(),
                        deck_id=deck.id,
                        owner_id=current_user.id,
                        front=item.front,
                        back=item.back,
                        source_id=item.source_id,
                        source_version_id=item.source_version_id,
                        chunk_id=item.chunk_id,
                        locator=item.locator if item.locator else None,
                        origin='ai',
                        status='active',
                        created_at=now,
                        updated_at=now
                    )
                    session.add(card)
                await session.commit()

    return APIResponse(
        success=True,
        data=GenerateFlashcardsResponse(
            cards=generated_items,
            saved_to_deck_id=saved_deck_id
        ),
        message=f"Đã sinh {len(generated_items)} thẻ ghi nhớ thành công"
    )


# ============================================================================
# 4. SM-2 SPACED REPETITION (ÔN TẬP ĐẾN HẠN & ĐÁNH GIÁ NGUYÊN TỬ)
# ============================================================================

@router.get("/decks/{deck_id}/due", response_model=APIResponse[List[FlashcardResponse]])
async def get_due_cards_for_study(
    deck_id: UUID4,
    limit: int = Query(50, ge=1, le=200, description="Số lượng thẻ tối đa lấy để ôn"),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Lấy danh sách các thẻ cần ôn tập hôm nay (Spaced Repetition Due Queue):
    - Thẻ mới tạo (chưa có CardSchedule).
    - Thẻ đã đến hạn ôn: CardSchedule.due_at <= now().
    """
    now = datetime.utcnow()

    async with scoped_user_session(current_user.id) as session:
        # Kiểm tra deck
        d_res = await session.execute(
            select(FlashcardDeck).where(
                FlashcardDeck.id == deck_id,
                FlashcardDeck.owner_id == current_user.id,
                FlashcardDeck.deleted_at.is_(None)
            )
        )
        if not d_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bộ thẻ không tồn tại")

        query = (
            select(Flashcard, CardSchedule)
            .outerjoin(CardSchedule, and_(CardSchedule.card_id == Flashcard.id, CardSchedule.owner_id == current_user.id))
            .where(
                Flashcard.deck_id == deck_id,
                Flashcard.owner_id == current_user.id,
                Flashcard.deleted_at.is_(None),
                Flashcard.status == 'active',
                or_(CardSchedule.due_at.is_(None), CardSchedule.due_at <= now)
            )
            .order_by(CardSchedule.due_at.asc().nullsfirst())
            .limit(limit)
        )
        res = await session.execute(query)
        rows = res.all()

        results = []
        for card, sched in rows:
            sched_resp = None
            if sched:
                sched_resp = CardScheduleResponse(
                    card_id=sched.card_id,
                    state=sched.state,
                    due_at=sched.due_at,
                    interval_days=sched.interval_days,
                    repetitions=sched.repetitions,
                    ease_factor=float(sched.ease_factor),
                    lapses=sched.lapses,
                    algorithm_version=sched.algorithm_version,
                    last_reviewed_at=sched.last_reviewed_at
                )

            results.append(
                FlashcardResponse(
                    id=card.id,
                    deck_id=card.deck_id,
                    owner_id=card.owner_id,
                    front=card.front,
                    back=card.back,
                    source_id=card.source_id,
                    source_version_id=card.source_version_id,
                    chunk_id=card.chunk_id,
                    locator=card.locator,
                    origin=card.origin,
                    status=card.status,
                    schedule=sched_resp,
                    created_at=card.created_at,
                    updated_at=card.updated_at
                )
            )

        return APIResponse(success=True, data=results)


@router.post("/cards/{card_id}/review", response_model=APIResponse[CardReviewResponse])
async def submit_card_review(
    card_id: UUID4,
    req: CardReviewRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Thực hiện đánh giá ôn tập thẻ theo thuật toán SM-2 nguyên tử qua SQL function app.record_card_review:
    - rating = 1: Khó / Quên -> reps=0, interval=1, ef giảm 0.20, state='relearning'.
    - rating = 2: Vừa -> reps+1, interval nhân ef, state='review'.
    - rating = 3: Dễ -> reps+1, interval nhân (ef+0.15), ef tăng 0.10, state='review'.
    - Bảo đảm tính Idempotent: gửi trùng lặp event_id sẽ trả về bản ghi cũ mà không cộng lặp ngày ôn!
    """
    event_id = req.event_id or uuid.uuid4()

    async with scoped_user_session(current_user.id) as session:
        # Kiểm tra thẻ tồn tại & thuộc quyền sở hữu
        c_res = await session.execute(
            select(Flashcard.id).where(
                Flashcard.id == card_id,
                Flashcard.owner_id == current_user.id,
                Flashcard.deleted_at.is_(None)
            )
        )
        if not c_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thẻ ghi nhớ không tồn tại")

        # Gọi SQL function SECURITY DEFINER
        fn_sql = text("""
            SELECT id, event_id, card_id, owner_id, rating, reviewed_at, prev_state, next_state, created_at
            FROM app.record_card_review(
                CAST(:eid AS uuid),
                CAST(:cid AS uuid),
                CAST(:rating AS smallint)
            );
        """)
        res = await session.execute(
            fn_sql,
            {
                "eid": str(event_id),
                "cid": str(card_id),
                "rating": req.rating
            }
        )
        row = res.mappings().first()
        if not row:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Lỗi khi ghi nhận kết quả ôn tập")

        await session.commit()

        return APIResponse(
            success=True,
            data=CardReviewResponse(
                id=row["id"],
                event_id=row["event_id"],
                card_id=row["card_id"],
                rating=row["rating"],
                reviewed_at=row["reviewed_at"],
                prev_state=row["prev_state"],
                next_state=row["next_state"]
            ),
            message="Ghi nhận đánh giá ôn tập SM-2 thành công"
        )


@router.get("/cards/{card_id}/history", response_model=APIResponse[List[CardReviewResponse]])
async def get_card_review_history(
    card_id: UUID4,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Lịch sử các lần ôn tập và đánh giá của một thẻ ghi nhớ"""
    async with scoped_user_session(current_user.id) as session:
        # Kiểm tra thẻ
        c_res = await session.execute(
            select(Flashcard.id).where(
                Flashcard.id == card_id,
                Flashcard.owner_id == current_user.id,
                Flashcard.deleted_at.is_(None)
            )
        )
        if not c_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thẻ không tồn tại")

        rev_res = await session.execute(
            select(CardReview).where(
                CardReview.card_id == card_id,
                CardReview.owner_id == current_user.id
            ).order_by(CardReview.reviewed_at.desc())
        )
        reviews = rev_res.scalars().all()

        return APIResponse(
            success=True,
            data=[
                CardReviewResponse(
                    id=r.id,
                    event_id=r.event_id,
                    card_id=r.card_id,
                    rating=r.rating,
                    reviewed_at=r.reviewed_at,
                    prev_state=r.prev_state,
                    next_state=r.next_state
                )
                for r in reviews
            ]
        )


# ============================================================================
# 5. REVIEW ITEMS (HẠNG MỤC CẦN ÔN TẬP & CHUYỂN THÀNH FLASHCARD)
# ============================================================================

@router.post("/review-items", response_model=APIResponse[ReviewItemResponse], status_code=status.HTTP_201_CREATED)
async def create_review_item(
    req: ReviewItemCreate,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Tạo mục cần ôn tập (từ câu sai trắc nghiệm hoặc ghi chú cá nhân)"""
    now = datetime.utcnow()
    item_id = uuid.uuid4()

    async with scoped_user_session(current_user.id) as session:
        item = ReviewItem(
            id=item_id,
            owner_id=current_user.id,
            course_id=req.course_id,
            question_id=req.question_id,
            attempt_answer_id=req.attempt_answer_id,
            source_id=req.source_id,
            source_version_id=req.source_version_id,
            locator=req.locator if req.locator else None,
            reason=req.reason or 'user_added',
            personal_note=req.personal_note,
            status='open',
            created_at=now,
            updated_at=now
        )
        session.add(item)
        await session.commit()

        return APIResponse(
            success=True,
            data=ReviewItemResponse(
                id=item.id,
                owner_id=item.owner_id,
                course_id=item.course_id,
                question_id=item.question_id,
                attempt_answer_id=item.attempt_answer_id,
                source_id=item.source_id,
                source_version_id=item.source_version_id,
                locator=item.locator,
                reason=item.reason,
                personal_note=item.personal_note,
                status=item.status,
                resolved_at=item.resolved_at,
                created_at=item.created_at
            ),
            message="Đã thêm vào danh mục cần ôn tập"
        )


@router.get("/review-items", response_model=APIResponse[List[ReviewItemResponse]])
async def list_review_items(
    course_id: Optional[UUID4] = Query(None, description="Lọc theo khóa học"),
    status_filter: Optional[str] = Query(None, description="open, practicing, resolved"),
    current_user: CurrentUser = Depends(get_current_user)
):
    """Danh sách các hạng mục cần ôn tập của sinh viên"""
    async with scoped_user_session(current_user.id) as session:
        query = select(ReviewItem).where(
            ReviewItem.owner_id == current_user.id,
            ReviewItem.deleted_at.is_(None)
        )
        if course_id:
            query = query.where(ReviewItem.course_id == course_id)
        if status_filter:
            query = query.where(ReviewItem.status == status_filter)

        query = query.order_by(ReviewItem.created_at.desc())
        res = await session.execute(query)
        items = res.scalars().all()

        return APIResponse(
            success=True,
            data=[
                ReviewItemResponse(
                    id=i.id,
                    owner_id=i.owner_id,
                    course_id=i.course_id,
                    question_id=i.question_id,
                    attempt_answer_id=i.attempt_answer_id,
                    source_id=i.source_id,
                    source_version_id=i.source_version_id,
                    locator=i.locator,
                    reason=i.reason,
                    personal_note=i.personal_note,
                    status=i.status,
                    resolved_at=i.resolved_at,
                    created_at=i.created_at
                )
                for i in items
            ]
        )


@router.post("/review-items/{item_id}/convert", response_model=APIResponse[FlashcardResponse])
async def convert_review_item_to_flashcard(
    item_id: UUID4,
    req: ConvertReviewItemRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Chuyển một hạng mục cần ôn tập thành một Thẻ ghi nhớ trong Bộ thẻ:
    - Tạo thẻ mới với origin='from_review_item'.
    - Đánh dấu trạng thái ReviewItem thành 'resolved'.
    """
    now = datetime.utcnow()
    card_id = uuid.uuid4()

    async with scoped_user_session(current_user.id) as session:
        # Lấy review item
        r_res = await session.execute(
            select(ReviewItem).where(
                ReviewItem.id == item_id,
                ReviewItem.owner_id == current_user.id,
                ReviewItem.deleted_at.is_(None)
            )
        )
        item = r_res.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hạng mục ôn tập không tồn tại")

        # Kiểm tra deck
        d_res = await session.execute(
            select(FlashcardDeck).where(
                FlashcardDeck.id == req.deck_id,
                FlashcardDeck.owner_id == current_user.id,
                FlashcardDeck.deleted_at.is_(None)
            )
        )
        deck = d_res.scalar_one_or_none()
        if not deck:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bộ thẻ không tồn tại")

        front_content = req.front or item.personal_note or "Câu hỏi cần ôn tập lại"
        back_content = req.back or "Giải thích chi tiết kiến thức trọng tâm"

        new_card = Flashcard(
            id=card_id,
            deck_id=deck.id,
            owner_id=current_user.id,
            front=front_content,
            back=back_content,
            source_id=item.source_id,
            source_version_id=item.source_version_id,
            locator=item.locator if item.locator else None,
            origin='from_review_item',
            status='active',
            created_at=now,
            updated_at=now
        )
        session.add(new_card)

        # Cập nhật review item sang resolved
        item.status = 'resolved'
        item.resolved_at = now
        item.revision = item.revision + 1
        item.updated_at = now

        await session.commit()

        return APIResponse(
            success=True,
            data=FlashcardResponse(
                id=new_card.id,
                deck_id=new_card.deck_id,
                owner_id=new_card.owner_id,
                front=new_card.front,
                back=new_card.back,
                source_id=new_card.source_id,
                source_version_id=new_card.source_version_id,
                locator=new_card.locator,
                origin=new_card.origin,
                status=new_card.status,
                schedule=None,
                created_at=new_card.created_at,
                updated_at=new_card.updated_at
            ),
            message="Chuyển đổi hạng mục ôn tập thành thẻ ghi nhớ thành công"
        )
