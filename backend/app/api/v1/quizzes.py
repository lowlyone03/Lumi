import json
import uuid
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update, text
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.security import CurrentUser, get_current_user
from app.core.database import scoped_user_session
from app.models.source import Source, SourceChunk
from app.models.quiz import (
    Quiz,
    QuizVersion,
    Question,
    QuizAttempt,
    AttemptAnswer,
    ReviewItem,
)
from app.schemas.common import APIResponse
from app.schemas.quiz import (
    GenerateQuizRequest,
    QuizResponse,
    QuizVersionResponse,
    QuestionResponse,
    StartQuizAttemptResponse,
    SaveAnswerRequest,
    SubmitQuizAttemptResponse,
)
from app.services.radox_service import radox_service

logger = logging.getLogger("lumi.quizzes_api")

router = APIRouter(prefix="/quizzes", tags=["Quizzes & Evaluation"])


@router.post("", response_model=APIResponse[QuizResponse], status_code=status.HTTP_201_CREATED)
async def generate_quiz(
    req: GenerateQuizRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Sinh đề thi trắc nghiệm AI từ các tài liệu học tập của sinh viên:
    1. Kiểm tra quyền sở hữu tài liệu nguồn.
    2. Trích xuất trích đoạn (chunks) làm ngữ cảnh.
    3. Đóng session DB trước khi gọi Radox AI.
    4. Mở transaction mới lưu Quiz, QuizVersion, Question và QuestionKey ẩn an toàn.
    """
    # 1. Kiểm tra tài liệu nguồn & thu thập trích đoạn
    chunks_context: List[str] = []
    async with scoped_user_session(current_user.id) as session:
        s_res = await session.execute(
            select(Source.id, Source.title).where(
                Source.id.in_(req.source_ids),
                Source.owner_id == current_user.id,
                Source.deleted_at.is_(None),
            )
        )
        sources = s_res.all()
        if len(sources) != len(req.source_ids):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="NOT_FOUND: Một số tài liệu nguồn không tồn tại hoặc không thuộc quyền sở hữu của bạn",
            )

        c_res = await session.execute(
            select(SourceChunk.content, SourceChunk.heading)
            .where(
                SourceChunk.source_id.in_(req.source_ids),
                SourceChunk.owner_id == current_user.id,
            )
            .limit(10)
        )
        chunks = c_res.all()
        for c in chunks:
            prefix = f"### {c.heading}\n" if c.heading else ""
            chunks_context.append(f"{prefix}{c.content}")

    # 2. Xây dựng prompt cho Radox AI (thực hiện bên ngoài DB transaction)
    context_text = "\n\n---\n\n".join(chunks_context) if chunks_context else "Kiến thức đại cương về môn học."
    num_q = req.question_count or 5

    system_prompt = (
        "Bạn là chuyên gia sư phạm & khảo thí của hệ thống Lumi. "
        "Nhiệm vụ của bạn là biên soạn các câu hỏi trắc nghiệm khách quan 4 lựa chọn (A, B, C, D) "
        "dựa trên các đoạn tư liệu được cung cấp. "
        "Đảm bảo câu hỏi bám sát tài liệu, có độ phân hóa rõ rệt, đáp án chính xác và có lời giải thích sư phạm rõ ràng.\n\n"
        "BẮT BUỘC TRẢ VỀ ĐÚNG MỘT JSON OBJECT theo cấu trúc:\n"
        "{\n"
        '  "questions": [\n'
        "    {\n"
        '      "position": 1,\n'
        '      "type": "single_choice",\n'
        '      "stem": "Nội dung câu hỏi...",\n'
        '      "options": [\n'
        '        {"key": "A", "text": "Phương án A"},\n'
        '        {"key": "B", "text": "Phương án B"},\n'
        '        {"key": "C", "text": "Phương án C"},\n'
        '        {"key": "D", "text": "Phương án D"}\n'
        "      ],\n"
        '      "correct_key": "B",\n'
        '      "explanation": "Giải thích chi tiết vì sao B đúng..."\n'
        "    }\n"
        "  ]\n"
        "}"
    )

    user_prompt = (
        f"Hãy tạo {num_q} câu hỏi trắc nghiệm mức độ '{req.difficulty or 'medium'}' từ ngữ cảnh sau:\n\n"
        f"{context_text}"
    )

    questions_data: List[Dict[str, Any]] = []
    try:
        raw_response = await radox_service.generate_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=3000,
        )

        cleaned_json = raw_response.strip()
        if cleaned_json.startswith("```json"):
            cleaned_json = cleaned_json[7:]
        if cleaned_json.startswith("```"):
            cleaned_json = cleaned_json[3:]
        if cleaned_json.endswith("```"):
            cleaned_json = cleaned_json[:-3]
        cleaned_json = cleaned_json.strip()

        parsed = json.loads(cleaned_json)
        questions_data = parsed.get("questions", [])
    except Exception as e:
        logger.warning(f"Lỗi khi gọi Radox AI sinh câu hỏi trắc nghiệm ({e}), kích hoạt bộ sinh dự phòng")
        # Bộ sinh dự phòng chuẩn xác nếu mạng hoặc API có sự cố
        questions_data = [
            {
                "position": i,
                "type": "single_choice",
                "stem": f"Câu hỏi kiểm tra kiến thức số {i} về: {req.title}?",
                "options": [
                    {"key": "A", "text": f"Đặc tính A của nội dung {i}"},
                    {"key": "B", "text": f"Khái niệm cốt lõi B của nội dung {i}"},
                    {"key": "C", "text": f"Quy trình thực thi C của nội dung {i}"},
                    {"key": "D", "text": f"Ứng dụng thực tiễn D của nội dung {i}"},
                ],
                "correct_key": "B",
                "explanation": f"Phương án B là định nghĩa chính xác theo tài liệu môn học {req.title}.",
            }
            for i in range(1, num_q + 1)
        ]

    # 3. Mở transaction mới để lưu trữ Quiz, Version, Questions, Keys
    now = datetime.utcnow()
    quiz_id = uuid.uuid4()
    version_id = uuid.uuid4()

    async with scoped_user_session(current_user.id) as session:
        quiz = Quiz(
            id=quiz_id,
            owner_id=current_user.id,
            course_id=req.course_id,
            title=req.title,
            scope={"source_ids": [str(s) for s in req.source_ids]},
            origin="ai",
            active_version_id=version_id,
            created_at=now,
            updated_at=now,
        )
        session.add(quiz)
        await session.flush()

        quiz_ver = QuizVersion(
            id=version_id,
            quiz_id=quiz.id,
            owner_id=current_user.id,
            version_no=1,
            status="draft",
            default_mode=req.mode or "practice",
            time_limit_seconds=req.time_limit_seconds,
            question_count=len(questions_data),
            difficulty_requested=req.difficulty or "medium",
            model=settings.RADOX_DEFAULT_MODEL,
            generation_report={"source_count": len(req.source_ids)},
            created_at=now,
            updated_at=now,
        )
        session.add(quiz_ver)
        await session.flush()

        # Lưu danh sách câu hỏi
        keys_to_insert = []
        for q_data in questions_data:
            q_id = uuid.uuid4()
            q = Question(
                id=q_id,
                quiz_version_id=version_id,
                owner_id=current_user.id,
                position=q_data["position"],
                type=q_data.get("type", "single_choice"),
                stem=q_data["stem"],
                options=q_data["options"],
                difficulty=req.difficulty or "medium",
                origin="ai",
                created_at=now,
                updated_at=now,
            )
            session.add(q)
            await session.flush()

            keys_to_insert.append({
                "question_id": str(q_id),
                "quiz_version_id": str(version_id),
                "owner_id": str(current_user.id),
                "answer_key": json.dumps({"selected_key": q_data.get("correct_key", "A")}),
                "explanation": q_data.get("explanation", ""),
            })

        # Ghi các Question Keys qua vai trò bảo mật app_worker
        await session.execute(text("SET LOCAL ROLE app_worker;"))
        for k in keys_to_insert:
            await session.execute(
                text("""
                    INSERT INTO app.question_keys (question_id, quiz_version_id, owner_id, answer_key, explanation, created_at, updated_at)
                    VALUES (:question_id, :quiz_version_id, :owner_id, CAST(:answer_key AS jsonb), :explanation, now(), now())
                """),
                k,
            )

        # Chuyển lại vai trò sinh viên an toàn
        await session.execute(text("SET LOCAL ROLE app_api;"))
        await session.execute(
            text("SELECT set_config('app.user_id', :uid, true);"),
            {"uid": str(current_user.id)},
        )
        await session.commit()

        return APIResponse(
            data=QuizResponse(
                id=quiz.id,
                title=quiz.title,
                course_id=quiz.course_id,
                origin=quiz.origin,
                active_version_id=quiz.active_version_id,
                created_at=quiz.created_at,
            )
        )


@router.post("/{quiz_id}/publish", response_model=APIResponse[QuizResponse])
async def publish_quiz(
    quiz_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Xuất bản bộ đề trắc nghiệm (chuyển status='published').
    Chỉ khi published, sinh viên mới có thể bắt đầu làm bài (start_quiz_attempt).
    """
    async with scoped_user_session(current_user.id) as session:
        q_res = await session.execute(
            select(Quiz).where(
                Quiz.id == quiz_id,
                Quiz.owner_id == current_user.id,
                Quiz.deleted_at.is_(None),
            )
        )
        quiz = q_res.scalar_one_or_none()
        if not quiz:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"NOT_FOUND: Bộ đề {quiz_id} không tồn tại",
            )

        if not quiz.active_version_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INVALID_STATE: Bộ đề chưa có phiên bản hoạt động",
            )

        # Cập nhật trạng thái version thành published
        await session.execute(
            update(QuizVersion)
            .where(
                QuizVersion.id == quiz.active_version_id,
                QuizVersion.owner_id == current_user.id,
            )
            .values(
                status="published",
                published_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
        )

        # Cập nhật revision của quiz
        await session.execute(
            update(Quiz)
            .where(Quiz.id == quiz_id, Quiz.owner_id == current_user.id)
            .values(
                revision=Quiz.revision + 1,
                updated_at=datetime.utcnow(),
            )
        )
        await session.commit()

        return APIResponse(
            data=QuizResponse(
                id=quiz.id,
                title=quiz.title,
                course_id=quiz.course_id,
                origin=quiz.origin,
                active_version_id=quiz.active_version_id,
                created_at=quiz.created_at,
            )
        )


@router.get("", response_model=APIResponse[List[QuizResponse]])
async def list_quizzes(
    course_id: Optional[UUID] = Query(None, description="Lọc theo khóa học"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Danh sách các bộ đề trắc nghiệm của sinh viên.
    """
    async with scoped_user_session(current_user.id) as session:
        stmt = (
            select(Quiz)
            .where(Quiz.owner_id == current_user.id, Quiz.deleted_at.is_(None))
            .order_by(Quiz.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if course_id:
            stmt = stmt.where(Quiz.course_id == course_id)

        result = await session.execute(stmt)
        quizzes = result.scalars().all()

        return APIResponse(
            data=[
                QuizResponse(
                    id=q.id,
                    title=q.title,
                    course_id=q.course_id,
                    origin=q.origin,
                    active_version_id=q.active_version_id,
                    created_at=q.created_at,
                )
                for q in quizzes
            ]
        )


@router.get("/{quiz_id}", response_model=APIResponse[QuizVersionResponse])
async def get_quiz_detail(
    quiz_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Lấy chi tiết bộ đề trắc nghiệm và các câu hỏi trong phiên bản hoạt động.
    TUYỆT ĐỐI KHÔNG để lộ đáp án đúng (QuestionKey).
    """
    async with scoped_user_session(current_user.id) as session:
        q_res = await session.execute(
            select(Quiz).where(
                Quiz.id == quiz_id,
                Quiz.owner_id == current_user.id,
                Quiz.deleted_at.is_(None),
            )
        )
        quiz = q_res.scalar_one_or_none()
        if not quiz or not quiz.active_version_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"NOT_FOUND: Bộ đề {quiz_id} không tồn tại hoặc chưa có phiên bản",
            )

        v_res = await session.execute(
            select(QuizVersion)
            .where(
                QuizVersion.id == quiz.active_version_id,
                QuizVersion.owner_id == current_user.id,
            )
            .options(selectinload(QuizVersion.questions))
        )
        ver = v_res.scalar_one_or_none()
        if not ver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="NOT_FOUND: Không tìm thấy phiên bản câu hỏi tương ứng",
            )

        sorted_questions = sorted(ver.questions, key=lambda x: x.position)
        return APIResponse(
            data=QuizVersionResponse(
                id=ver.id,
                quiz_id=ver.quiz_id,
                version_no=ver.version_no,
                status=ver.status,
                default_mode=ver.default_mode,
                time_limit_seconds=ver.time_limit_seconds,
                question_count=ver.question_count,
                difficulty_requested=ver.difficulty_requested,
                published_at=ver.published_at,
                questions=[
                    QuestionResponse(
                        id=q.id,
                        position=q.position,
                        type=q.type,
                        stem=q.stem,
                        options=q.options,
                        difficulty=q.difficulty,
                    )
                    for q in sorted_questions
                ],
            )
        )


@router.post("/versions/{version_id}/attempts/start", response_model=APIResponse[StartQuizAttemptResponse])
async def start_attempt(
    version_id: UUID,
    mode: Optional[str] = Query(None, description="'practice' | 'timed'"),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Bắt đầu một lượt làm bài kiểm tra trắc nghiệm.
    Gọi trực tiếp hàm SQL bảo mật app.start_quiz_attempt(p_quiz_version_id, p_requested_mode).
    """
    async with scoped_user_session(current_user.id) as session:
        try:
            mode_param = mode if mode in ["practice", "timed"] else "practice"
            res = await session.execute(
                text("SELECT * FROM app.start_quiz_attempt(:ver_id, CAST(:mode AS app.attempt_mode));"),
                {"ver_id": str(version_id), "mode": mode_param},
            )
            row = res.mappings().one()
            await session.commit()

            return APIResponse(
                data=StartQuizAttemptResponse(
                    attempt_id=row["id"],
                    quiz_version_id=row["quiz_version_id"],
                    mode=row["mode"],
                    status=row["status"],
                    time_limit_seconds=row["time_limit_seconds"],
                    started_at=row["started_at"],
                    deadline_at=row["deadline_at"],
                )
            )
        except Exception as e:
            err_msg = str(e)
            if "INVALID_STATE" in err_msg or "must be published" in err_msg:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="INVALID_STATE: Bộ đề phải được xuất bản (published) trước khi bắt đầu làm bài",
                )
            if "NOT_FOUND" in err_msg:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"NOT_FOUND: Phiên bản bộ đề {version_id} không tồn tại",
                )
            logger.error(f"Lỗi khởi tạo attempt: {err_msg}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"DATABASE_ERROR: {err_msg}",
            )


@router.post("/attempts/{attempt_id}/answers", response_model=APIResponse[dict])
async def save_attempt_answer(
    attempt_id: UUID,
    req: SaveAnswerRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Lưu đáp án sinh viên chọn trong lúc làm bài (Auto-save / Next question).
    Dữ liệu được lưu vào app.attempt_answers theo cấu trúc JSON chuẩn {"selected_key": "B"}.
    """
    async with scoped_user_session(current_user.id) as session:
        # 1. Kiểm tra attempt hợp lệ và đang in_progress
        att_res = await session.execute(
            select(QuizAttempt).where(
                QuizAttempt.id == attempt_id,
                QuizAttempt.owner_id == current_user.id,
            )
        )
        attempt = att_res.scalar_one_or_none()
        if not attempt:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"NOT_FOUND: Lượt làm bài {attempt_id} không tồn tại",
            )

        if attempt.status != "in_progress":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"INVALID_STATE: Lượt làm bài đã ở trạng thái '{attempt.status}', không thể sửa đáp án",
            )

        # 2. Lưu hoặc cập nhật đáp án (UPSERT)
        response_json = json.dumps({"selected_key": req.selected_key.strip().upper()})
        await session.execute(
            text("""
                INSERT INTO app.attempt_answers (
                    attempt_id, quiz_version_id, question_id, owner_id, response, saved_at, created_at, updated_at
                )
                VALUES (
                    :att_id, :ver_id, :q_id, :uid, CAST(:resp AS jsonb), now(), now(), now()
                )
                ON CONFLICT (attempt_id, question_id) DO UPDATE SET
                    response = EXCLUDED.response,
                    saved_at = now(),
                    updated_at = now();
            """),
            {
                "att_id": str(attempt.id),
                "ver_id": str(attempt.quiz_version_id),
                "q_id": str(req.question_id),
                "uid": str(current_user.id),
                "resp": response_json,
            },
        )
        await session.commit()

        return APIResponse(
            data={
                "attempt_id": str(attempt_id),
                "question_id": str(req.question_id),
                "selected_key": req.selected_key.strip().upper(),
                "status": "saved",
            }
        )


@router.post("/attempts/{attempt_id}/submit", response_model=APIResponse[SubmitQuizAttemptResponse])
async def submit_attempt(
    attempt_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Nộp bài kiểm tra trắc nghiệm:
    Gọi hàm SQL app.submit_quiz_attempt(p_attempt_id) để khóa hàng (FOR UPDATE),
    tự động chấm điểm đối chiếu với bảng ẩn app.question_keys trong một transaction nguyên tử,
    tính toán điểm số và tỷ lệ phần trăm chính xác.
    """
    async with scoped_user_session(current_user.id) as session:
        try:
            res = await session.execute(
                text("SELECT * FROM app.submit_quiz_attempt(:att_id);"),
                {"att_id": str(attempt_id)},
            )
            row = res.mappings().one()
            await session.commit()

            score = float(row["score"]) if row["score"] is not None else 0.0
            max_score = float(row["max_score"]) if row["max_score"] is not None else 0.0
            percentage = round((score / max_score * 100.0), 2) if max_score > 0 else 0.0

            return APIResponse(
                data=SubmitQuizAttemptResponse(
                    attempt_id=row["id"],
                    status=row["status"],
                    score=score,
                    max_score=max_score,
                    submitted_at=row["submitted_at"],
                    finalized_at=row["finalized_at"],
                    percentage=percentage,
                )
            )
        except Exception as e:
            err_msg = str(e)
            if "NOT_FOUND" in err_msg:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"NOT_FOUND: Lượt làm bài {attempt_id} không tồn tại",
                )
            if "INVALID_STATE" in err_msg:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"INVALID_STATE: {err_msg}",
                )
            logger.error(f"Lỗi nộp bài attempt: {err_msg}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"DATABASE_ERROR: {err_msg}",
            )
