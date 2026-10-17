import json
import uuid
import time
from datetime import datetime
import logging
from typing import List, Optional, AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text, delete
from sqlalchemy.orm import selectinload

from app.core.security import CurrentUser, get_current_user
from app.core.database import scoped_user_session
from app.models.source import Source, SourceChunk
from app.models.conversation import (
    Conversation,
    ConversationSource,
    Message,
    MessageCitation,
    RetrievalLog,
    AIRequest,
)
from app.schemas.common import APIResponse
from app.schemas.conversation import (
    CreateConversationRequest,
    ConversationResponse,
    ConversationDetailResponse,
    ConversationSourceResponse,
    SendMessageRequest,
    MessageResponse,
    CitationResponse,
)
from app.services.rag_service import rag_service, RetrievedChunk
from app.services.radox_service import radox_service
from app.services.embedding_service import embedding_service

logger = logging.getLogger("lumi.conversations_api")

router = APIRouter(prefix="/conversations", tags=["Conversations & RAG Chat"])


@router.post("", response_model=APIResponse[ConversationResponse], status_code=status.HTTP_201_CREATED)
async def create_conversation(
    req: CreateConversationRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Khởi tạo cuộc trò chuyện hỏi đáp mới liên kết với tài liệu học tập của sinh viên.
    """
    async with scoped_user_session(current_user.id) as session:
        # 1. Kiểm tra quyền sở hữu các tài liệu được chọn
        s_res = await session.execute(
            select(Source).where(
                Source.id.in_(req.source_ids),
                Source.owner_id == current_user.id,
                Source.deleted_at.is_(None)
            )
        )
        sources = s_res.scalars().all()
        if len(sources) != len(req.source_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INVALID_SOURCES: Một hoặc nhiều tài liệu không tồn tại hoặc không thuộc quyền sở hữu của bạn"
            )

        # 2. Tạo bản ghi app.conversations
        conv_id = uuid.uuid4()
        now = datetime.utcnow()
        title = req.title or (f"Hỏi đáp: {sources[0].title[:30]}" if sources else "Cuộc trò chuyện mới")
        new_conv = Conversation(
            id=conv_id,
            owner_id=current_user.id,
            title=title,
            scope_type=req.scope_type or "single_source",
            explain_style=req.explain_style,
            last_message_at=now,
            created_at=now,
            updated_at=now,
            revision=1,
            change_seq=1
        )
        session.add(new_conv)

        # 3. Tạo bản ghi app.conversation_sources
        source_responses = []
        for src in sources:
            cs = ConversationSource(
                conversation_id=conv_id,
                source_id=src.id,
                owner_id=current_user.id,
                added_at=now
            )
            session.add(cs)
            source_responses.append(
                ConversationSourceResponse(
                    source_id=src.id,
                    title=src.title,
                    added_at=now
                )
            )

        await session.commit()

        return APIResponse(
            success=True,
            data=ConversationResponse(
                id=new_conv.id,
                title=new_conv.title,
                scope_type=new_conv.scope_type,
                explain_style=new_conv.explain_style,
                last_message_at=now,
                created_at=now,
                sources=source_responses
            ),
            message="Khởi tạo cuộc trò chuyện thành công"
        )


@router.get("", response_model=APIResponse[List[ConversationResponse]])
async def list_conversations(
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Danh sách toàn bộ các cuộc hội thoại của sinh viên (RLS tự động lọc).
    """
    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(Conversation)
            .where(Conversation.owner_id == current_user.id)
            .order_by(Conversation.last_message_at.desc())
        )
        conversations = res.scalars().all()

        data: List[ConversationResponse] = []
        for c in conversations:
            # Lấy danh sách nguồn
            cs_res = await session.execute(
                select(ConversationSource, Source.title)
                .join(Source, Source.id == ConversationSource.source_id)
                .where(ConversationSource.conversation_id == c.id)
            )
            sources = [
                ConversationSourceResponse(
                    source_id=row[0].source_id,
                    title=row[1],
                    added_at=row[0].added_at
                )
                for row in cs_res.all()
            ]

            data.append(ConversationResponse(
                id=c.id,
                title=c.title,
                scope_type=c.scope_type,
                explain_style=c.explain_style,
                last_message_at=c.last_message_at,
                created_at=c.created_at,
                sources=sources
            ))

        return APIResponse(success=True, data=data)


@router.get("/{conversation_id}", response_model=APIResponse[ConversationDetailResponse])
async def get_conversation_detail(
    conversation_id: UUID,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Lấy thông tin chi tiết cuộc trò chuyện và toàn bộ lịch sử tin nhắn kèm trích dẫn.
    """
    async with scoped_user_session(current_user.id) as session:
        c_res = await session.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.owner_id == current_user.id
            )
        )
        c = c_res.scalar_one_or_none()
        if not c:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="CONVERSATION_NOT_FOUND: Cuộc trò chuyện không tồn tại"
            )

        # Lấy danh sách nguồn
        cs_res = await session.execute(
            select(ConversationSource, Source.title)
            .join(Source, Source.id == ConversationSource.source_id)
            .where(ConversationSource.conversation_id == c.id)
        )
        sources = [
            ConversationSourceResponse(
                source_id=row[0].source_id,
                title=row[1],
                added_at=row[0].added_at
            )
            for row in cs_res.all()
        ]

        # Lấy lịch sử tin nhắn kèm citations
        m_res = await session.execute(
            select(Message)
            .where(Message.conversation_id == c.id)
            .order_by(Message.created_at.asc())
        )
        messages = m_res.scalars().all()

        msg_responses: List[MessageResponse] = []
        for m in messages:
            cit_res = await session.execute(
                select(MessageCitation)
                .where(MessageCitation.message_id == m.id)
                .order_by(MessageCitation.ordinal.asc())
            )
            citations = [
                CitationResponse(
                    ordinal=cit.ordinal,
                    chunk_id=cit.chunk_id,
                    source_id=cit.source_id,
                    locator=cit.locator_snapshot or {},
                    quote=cit.quote,
                    validation_status=cit.validation_status
                )
                for cit in cit_res.scalars().all()
            ]

            msg_responses.append(MessageResponse(
                id=m.id,
                conversation_id=m.conversation_id,
                role=m.role,
                intent=m.intent,
                content=m.content,
                status=m.status,
                source_sufficiency=m.source_sufficiency,
                uses_external_knowledge=m.uses_external_knowledge,
                model=m.model,
                created_at=m.created_at,
                citations=citations
            ))

        return APIResponse(
            success=True,
            data=ConversationDetailResponse(
                id=c.id,
                title=c.title,
                scope_type=c.scope_type,
                explain_style=c.explain_style,
                last_message_at=c.last_message_at,
                created_at=c.created_at,
                sources=sources,
                messages=msg_responses
            )
        )


@router.delete("/{conversation_id}", response_model=APIResponse[dict])
async def delete_conversation(
    conversation_id: UUID,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Xóa cuộc trò chuyện (cascades toàn bộ tin nhắn và trích dẫn).
    """
    async with scoped_user_session(current_user.id) as session:
        c_res = await session.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.owner_id == current_user.id
            )
        )
        c = c_res.scalar_one_or_none()
        if not c:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="CONVERSATION_NOT_FOUND: Cuộc trò chuyện không tồn tại"
            )

        await session.execute(
            delete(Conversation).where(Conversation.id == conversation_id)
        )
        await session.commit()

        return APIResponse(success=True, data={"id": str(conversation_id)}, message="Xóa cuộc trò chuyện thành công")


@router.post("/{conversation_id}/messages", response_model=APIResponse[MessageResponse])
async def send_message(
    conversation_id: UUID,
    req: SendMessageRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Gửi tin nhắn hỏi đáp RAG dạng Đồng bộ (Non-streaming):
    1. Transaction 1: Giữ chỗ quota (app.reserve_ai_quota) & Truy xuất chunks liên quan (app.match_chunks).
    2. Đóng Transaction: Gọi Radox AI ngoài luồng DB.
    3. Transaction 2: Lưu trữ tin nhắn, citations và quyết toán quota (app.settle_ai_quota).
    """
    start_time = time.time()
    idempotency_key = f"chat:{conversation_id}:{uuid.uuid4()}"

    # --- TRANSACTION 1: Kiểm tra quyền, Giữ Quota AI & Truy xuất RAG ---
    async with scoped_user_session(current_user.id) as session:
        # Kiểm tra hội thoại
        c_res = await session.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.owner_id == current_user.id
            )
        )
        conv = c_res.scalar_one_or_none()
        if not conv:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="CONVERSATION_NOT_FOUND: Cuộc trò chuyện không tồn tại"
            )

        # Lấy danh sách source_id trong phạm vi hội thoại
        cs_res = await session.execute(
            select(ConversationSource.source_id).where(
                ConversationSource.conversation_id == conversation_id
            )
        )
        scope_source_ids = [row[0] for row in cs_res.all()]
        if req.source_ids:
            target_source_ids = [s for s in req.source_ids if s in scope_source_ids]
        else:
            target_source_ids = scope_source_ids

        # Giữ chỗ hạn mức AI
        try:
            reserve_sql = text("""
                SELECT id FROM app.reserve_ai_quota(
                    p_idempotency_key := :ikey,
                    p_feature := 'chat'::app.ai_feature,
                    p_units := 1,
                    p_target_type := 'conversation',
                    p_target_id := :cid
                );
            """)
            r_res = await session.execute(reserve_sql, {
                "ikey": idempotency_key,
                "cid": str(conversation_id)
            })
            ai_request_id = r_res.scalar()
        except Exception as e:
            logger.error(f"Lỗi giữ chỗ quota AI: {e}")
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"AI_QUOTA_EXCEEDED: Hạn mức hỏi đáp AI trong tháng đã hết hoặc đang xử lý ({e})"
            )

        # Lấy lịch sử 4 tin nhắn gần nhất để làm ngữ cảnh
        hist_res = await session.execute(
            select(Message.role, Message.content)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(4)
        )
        history_rows = list(reversed(hist_res.all()))
        history_messages = [{"role": r[0], "content": r[1]} for r in history_rows]

        # Truy xuất học liệu liên quan (RAG Hybrid match_chunks)
        retrieved_chunks = await rag_service.retrieve_chunks(
            session=session,
            source_ids=target_source_ids,
            query_text=req.content,
            match_count=5
        )

        explain_style = conv.explain_style
        # Hết Transaction 1: Tự động commit & trả connection về pool

    # --- NGOÀI TRANSACTION: GỌI RADOX AI GATEWAY ---
    prompt_messages = rag_service.build_prompt_messages(
        query_text=req.content,
        retrieved_chunks=retrieved_chunks,
        history_messages=history_messages,
        explain_style=explain_style
    )

    try:
        assistant_content = await radox_service.generate_completion(prompt_messages)
    except Exception as e:
        logger.error(f"Lỗi khi gọi Radox AI: {e}")
        # Giải phóng quota nếu AI lỗi
        async with scoped_user_session(current_user.id) as session:
            await session.execute(
                text("SELECT app.settle_ai_quota(:rid, false);"),
                {"rid": str(ai_request_id)}
            )
            await session.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"RADOX_GATEWAY_ERROR: Không thể nhận phản hồi từ AI Gateway ({e})"
        )

    latency_ms = int((time.time() - start_time) * 1000)

    # --- TRANSACTION 2: LƯU TRỮ KẾT QUẢ & QUYẾT TOÁN QUOTA ---
    user_msg_id = uuid.uuid4()
    asst_msg_id = uuid.uuid4()

    # Bóc tách trích dẫn citations
    raw_citations = rag_service.match_citations(assistant_content, retrieved_chunks)

    async with scoped_user_session(current_user.id) as session:
        # 1. Lưu tin nhắn của sinh viên
        user_msg = Message(
            id=user_msg_id,
            conversation_id=conversation_id,
            owner_id=current_user.id,
            role="user",
            intent=req.intent or "ask",
            content=req.content,
            status="completed"
        )
        session.add(user_msg)

        # 2. Lưu tin nhắn của trợ giảng Lumi
        asst_msg = Message(
            id=asst_msg_id,
            conversation_id=conversation_id,
            owner_id=current_user.id,
            role="assistant",
            intent=req.intent or "ask",
            content=assistant_content,
            status="completed",
            source_sufficiency="sufficient" if retrieved_chunks else "insufficient",
            sufficiency_assessed_by="ai",
            uses_external_knowledge=not bool(retrieved_chunks),
            model=radox_service.default_model,
            ai_request_id=ai_request_id
        )
        session.add(asst_msg)

        # 3. Lưu các trích dẫn citations (Bảo đảm thỏa mãn app.is_valid_locator và tg_validate_citation_scope)
        citation_responses: List[CitationResponse] = []
        for ordinal, chunk, quote in raw_citations:
            # Tạo snapshot locator hợp lệ (chỉ type, page, page_end)
            clean_locator = {
                "type": "pdf_page",
                "page": chunk.locator.get("page", 1)
            }
            if chunk.locator.get("page_end"):
                clean_locator["page_end"] = chunk.locator["page_end"]

            new_cit = MessageCitation(
                id=uuid.uuid4(),
                message_id=asst_msg_id,
                owner_id=current_user.id,
                ordinal=ordinal,
                chunk_id=chunk.chunk_id,
                source_id=chunk.source_id,
                source_version_id=chunk.source_version_id,
                locator_snapshot=clean_locator,
                quote=quote,
                validation_status="valid",
                support_status="unchecked"
            )
            session.add(new_cit)
            citation_responses.append(CitationResponse(
                ordinal=ordinal,
                chunk_id=chunk.chunk_id,
                source_id=chunk.source_id,
                locator=clean_locator,
                quote=quote,
                validation_status="valid"
            ))

        # 4. Lưu nhật ký truy xuất RAG (app.retrieval_logs)
        ret_log = RetrievalLog(
            id=uuid.uuid4(),
            message_id=asst_msg_id,
            owner_id=current_user.id,
            method="hybrid",
            embedding_model_id=embedding_service.model_id,
            top_k=len(retrieved_chunks),
            candidate_chunk_ids=[c.chunk_id for c in retrieved_chunks],
            selected_chunk_ids=[c.chunk_id for _, c, _ in raw_citations],
            scores=[c.combined_score for c in retrieved_chunks],
            rejected_source_ids=[],
            latency_ms=latency_ms,
            config={"rrf_k": 60, "match_count": 5}
        )
        session.add(ret_log)

        # 5. Cập nhật last_message_at và tăng revision của hội thoại
        await session.execute(
            text("UPDATE app.conversations SET last_message_at = now(), revision = revision + 1 WHERE id = :cid;"),
            {"cid": str(conversation_id)}
        )

        # 6. Quyết toán hạn mức AI Quota (commit = true)
        await session.execute(
            text("SELECT app.settle_ai_quota(:rid, true, 1);"),
            {"rid": str(ai_request_id)}
        )

        await session.commit()

        return APIResponse(
            success=True,
            data=MessageResponse(
                id=asst_msg.id,
                conversation_id=asst_msg.conversation_id,
                role=asst_msg.role,
                intent=asst_msg.intent,
                content=asst_msg.content,
                status=asst_msg.status,
                source_sufficiency=asst_msg.source_sufficiency,
                uses_external_knowledge=asst_msg.uses_external_knowledge,
                model=asst_msg.model,
                created_at=asst_msg.created_at,
                citations=citation_responses
            ),
            message="Nhận phản hồi từ trợ giảng Lumi thành công"
        )


@router.post("/{conversation_id}/messages/stream")
async def send_message_stream(
    conversation_id: UUID,
    req: SendMessageRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Gửi tin nhắn hỏi đáp RAG với Server-Sent Events (SSE) Streaming thời gian thực:
    - Sự kiện 1: message_started (ID tin nhắn và thông tin đối chiếu)
    - Sự kiện 2: delta (từng token / đoạn text sinh ra từ Radox AI)
    - Sự kiện 3: citations (trích dẫn học liệu được backend kiểm tra hợp lệ)
    - Sự kiện 4: completed (kết thúc sinh câu trả lời)
    - Sự kiện 5: error (nếu xảy ra lỗi)
    """
    start_time = time.time()
    idempotency_key = f"chat_stream:{conversation_id}:{uuid.uuid4()}"

    # --- TRANSACTION 1: Kiểm tra quyền, Giữ Quota AI & Truy xuất RAG ---
    async with scoped_user_session(current_user.id) as session:
        # Kiểm tra hội thoại
        c_res = await session.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.owner_id == current_user.id
            )
        )
        conv = c_res.scalar_one_or_none()
        if not conv:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="CONVERSATION_NOT_FOUND: Cuộc trò chuyện không tồn tại"
            )

        # Lấy danh sách source_id trong phạm vi hội thoại
        cs_res = await session.execute(
            select(ConversationSource.source_id).where(
                ConversationSource.conversation_id == conversation_id
            )
        )
        scope_source_ids = [row[0] for row in cs_res.all()]
        if req.source_ids:
            target_source_ids = [s for s in req.source_ids if s in scope_source_ids]
        else:
            target_source_ids = scope_source_ids

        # Giữ chỗ hạn mức AI
        try:
            reserve_sql = text("""
                SELECT id FROM app.reserve_ai_quota(
                    p_idempotency_key := :ikey,
                    p_feature := 'chat'::app.ai_feature,
                    p_units := 1,
                    p_target_type := 'conversation',
                    p_target_id := :cid
                );
            """)
            r_res = await session.execute(reserve_sql, {
                "ikey": idempotency_key,
                "cid": str(conversation_id)
            })
            ai_request_id = r_res.scalar()
        except Exception as e:
            logger.error(f"Lỗi giữ chỗ quota AI: {e}")
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"AI_QUOTA_EXCEEDED: Hạn mức hỏi đáp AI trong tháng đã hết ({e})"
            )

        # Lấy lịch sử tin nhắn
        hist_res = await session.execute(
            select(Message.role, Message.content)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(4)
        )
        history_rows = list(reversed(hist_res.all()))
        history_messages = [{"role": r[0], "content": r[1]} for r in history_rows]

        # Truy xuất RAG
        retrieved_chunks = await rag_service.retrieve_chunks(
            session=session,
            source_ids=target_source_ids,
            query_text=req.content,
            match_count=5
        )

        explain_style = conv.explain_style
        # Đóng Transaction 1 sạch sẽ!

    prompt_messages = rag_service.build_prompt_messages(
        query_text=req.content,
        retrieved_chunks=retrieved_chunks,
        history_messages=history_messages,
        explain_style=explain_style
    )

    asst_msg_id = uuid.uuid4()
    user_msg_id = uuid.uuid4()

    async def sse_event_stream() -> AsyncGenerator[str, None]:
        full_content_accumulated = []

        try:
            # 1. Bắn sự kiện message_started
            start_payload = {
                "message_id": str(asst_msg_id),
                "conversation_id": str(conversation_id),
                "model": radox_service.default_model,
                "timestamp": time.time()
            }
            yield f"event: message_started\ndata: {json.dumps(start_payload)}\n\n"

            # 2. Stream từng token delta từ Radox AI
            async for token in radox_service.stream_completion(prompt_messages):
                full_content_accumulated.append(token)
                delta_payload = {"delta": token}
                yield f"event: delta\ndata: {json.dumps(delta_payload)}\n\n"

            final_text = "".join(full_content_accumulated)
            latency_ms = int((time.time() - start_time) * 1000)

            # 3. Bóc tách citations
            raw_citations = rag_service.match_citations(final_text, retrieved_chunks)
            citations_list = []
            for ordinal, chunk, quote in raw_citations:
                clean_locator = {
                    "type": "pdf_page",
                    "page": chunk.locator.get("page", 1)
                }
                if chunk.locator.get("page_end"):
                    clean_locator["page_end"] = chunk.locator["page_end"]

                citations_list.append({
                    "ordinal": ordinal,
                    "chunk_id": str(chunk.chunk_id),
                    "source_id": str(chunk.source_id),
                    "source_version_id": str(chunk.source_version_id),
                    "locator": clean_locator,
                    "quote": quote
                })

            yield f"event: citations\ndata: {json.dumps(citations_list)}\n\n"

            # 4. Giao dịch Transaction 2: Lưu trữ dữ liệu và quyết toán Quota
            async with scoped_user_session(current_user.id) as session:
                user_msg = Message(
                    id=user_msg_id,
                    conversation_id=conversation_id,
                    owner_id=current_user.id,
                    role="user",
                    intent=req.intent or "ask",
                    content=req.content,
                    status="completed"
                )
                session.add(user_msg)

                asst_msg = Message(
                    id=asst_msg_id,
                    conversation_id=conversation_id,
                    owner_id=current_user.id,
                    role="assistant",
                    intent=req.intent or "ask",
                    content=final_text,
                    status="completed",
                    source_sufficiency="sufficient" if retrieved_chunks else "insufficient",
                    sufficiency_assessed_by="ai",
                    uses_external_knowledge=not bool(retrieved_chunks),
                    model=radox_service.default_model,
                    ai_request_id=ai_request_id
                )
                session.add(asst_msg)

                for cit in citations_list:
                    new_cit = MessageCitation(
                        id=uuid.uuid4(),
                        message_id=asst_msg_id,
                        owner_id=current_user.id,
                        ordinal=cit["ordinal"],
                        chunk_id=UUID(cit["chunk_id"]),
                        source_id=UUID(cit["source_id"]),
                        source_version_id=UUID(cit["source_version_id"]),
                        locator_snapshot=cit["locator"],
                        quote=cit["quote"],
                        validation_status="valid",
                        support_status="unchecked"
                    )
                    session.add(new_cit)

                ret_log = RetrievalLog(
                    id=uuid.uuid4(),
                    message_id=asst_msg_id,
                    owner_id=current_user.id,
                    method="hybrid",
                    embedding_model_id=embedding_service.model_id,
                    top_k=len(retrieved_chunks),
                    candidate_chunk_ids=[c.chunk_id for c in retrieved_chunks],
                    selected_chunk_ids=[UUID(cit["chunk_id"]) for cit in citations_list],
                    scores=[c.combined_score for c in retrieved_chunks],
                    rejected_source_ids=[],
                    latency_ms=latency_ms,
                    config={"rrf_k": 60, "match_count": 5}
                )
                session.add(ret_log)

                await session.execute(
                    text("UPDATE app.conversations SET last_message_at = now(), revision = revision + 1 WHERE id = :cid;"),
                    {"cid": str(conversation_id)}
                )

                await session.execute(
                    text("SELECT app.settle_ai_quota(:rid, true, 1);"),
                    {"rid": str(ai_request_id)}
                )

                await session.commit()

            # 5. Bắn sự kiện completed
            completed_payload = {
                "status": "completed",
                "latency_ms": latency_ms,
                "model": radox_service.default_model,
                "chunks_retrieved": len(retrieved_chunks)
            }
            yield f"event: completed\ndata: {json.dumps(completed_payload)}\n\n"

        except Exception as e:
            logger.error(f"Lỗi trong quá trình streaming SSE: {e}", exc_info=True)
            # Rollback quota
            try:
                async with scoped_user_session(current_user.id) as session:
                    await session.execute(
                        text("SELECT app.settle_ai_quota(:rid, false);"),
                        {"rid": str(ai_request_id)}
                    )
                    await session.commit()
            except Exception as se:
                logger.error(f"Lỗi khi giải phóng quota: {se}")

            error_payload = {
                "error": str(e),
                "code": "STREAMING_ERROR"
            }
            yield f"event: error\ndata: {json.dumps(error_payload)}\n\n"

    return StreamingResponse(
        sse_event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
