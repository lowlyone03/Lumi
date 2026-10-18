import json
import uuid
import logging
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text, delete
from sqlalchemy.orm import selectinload

from app.core.security import CurrentUser, get_current_user
from app.core.database import scoped_user_session
from app.models.source import Source, SourceVersion
from app.models.course import (
    Course,
    CourseSource,
    CurriculumDraft,
    Chapter,
    Lesson,
    LessonSource,
    SourceProgress,
    LessonProgress,
)
from app.schemas.common import APIResponse
from app.schemas.course import (
    CreateCourseRequest,
    CourseResponse,
    CourseDetailResponse,
    ChapterResponse,
    LessonResponse,
    GenerateCurriculumDraftRequest,
    CurriculumDraftResponse,
    UpdateSourceProgressRequest,
    SourceProgressResponse,
    UpdateLessonProgressRequest,
    LessonProgressResponse,
)
from app.services.radox_service import radox_service

logger = logging.getLogger("lumi.courses_api")

router = APIRouter(prefix="/courses", tags=["Courses & Curriculum"])


@router.post("", response_model=APIResponse[CourseResponse], status_code=status.HTTP_201_CREATED)
async def create_course(
    req: CreateCourseRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Tạo mới một khóa học và liên kết với tài liệu học tập của sinh viên"""
    now = datetime.utcnow()
    course_id = uuid.uuid4()

    async with scoped_user_session(current_user.id) as session:
        # Kiểm tra nguồn nếu có truyền vào
        if req.source_ids:
            s_res = await session.execute(
                select(Source.id).where(
                    Source.id.in_(req.source_ids),
                    Source.owner_id == current_user.id,
                    Source.deleted_at.is_(None)
                )
            )
            valid_source_ids = [row[0] for row in s_res.all()]
            if len(valid_source_ids) != len(req.source_ids):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="INVALID_SOURCES: Một hoặc nhiều học liệu không thuộc quyền sở hữu của bạn"
                )

        new_course = Course(
            id=course_id,
            owner_id=current_user.id,
            title=req.title,
            description=req.description,
            goal=req.goal,
            target_date=req.target_date,
            color=req.color or "#4F46E5",
            curriculum_revision=0,
            revision=1,
            change_seq=1,
            created_at=now,
            updated_at=now
        )
        session.add(new_course)

        # Liên kết nguồn
        if req.source_ids:
            for idx, sid in enumerate(req.source_ids):
                cs = CourseSource(
                    course_id=course_id,
                    source_id=sid,
                    owner_id=current_user.id,
                    position=idx,
                    added_at=now
                )
                session.add(cs)

        await session.commit()

        return APIResponse(
            success=True,
            data=CourseResponse(
                id=new_course.id,
                title=new_course.title,
                description=new_course.description,
                goal=new_course.goal,
                target_date=new_course.target_date,
                status=new_course.status,
                color=new_course.color,
                curriculum_revision=new_course.curriculum_revision,
                last_studied_at=new_course.last_studied_at,
                created_at=now,
                updated_at=now
            ),
            message="Khởi tạo khóa học thành công"
        )


@router.get("", response_model=APIResponse[List[CourseResponse]])
async def list_courses(
    current_user: CurrentUser = Depends(get_current_user)
):
    """Danh sách toàn bộ khóa học đang hoạt động của sinh viên (RLS tự động lọc)"""
    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(Course).where(
                Course.owner_id == current_user.id,
                Course.deleted_at.is_(None)
            ).order_by(Course.updated_at.desc())
        )
        courses = res.scalars().all()

        data = [
            CourseResponse(
                id=c.id,
                title=c.title,
                description=c.description,
                goal=c.goal,
                target_date=c.target_date,
                status=c.status,
                color=c.color,
                curriculum_revision=c.curriculum_revision,
                last_studied_at=c.last_studied_at,
                created_at=c.created_at,
                updated_at=c.updated_at
            )
            for c in courses
        ]
        return APIResponse(success=True, data=data)


@router.get("/{course_id}", response_model=APIResponse[CourseDetailResponse])
async def get_course_detail(
    course_id: UUID,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Lấy chi tiết khóa học kèm danh sách chương, bài học và tài liệu liên kết"""
    async with scoped_user_session(current_user.id) as session:
        c_res = await session.execute(
            select(Course).where(
                Course.id == course_id,
                Course.owner_id == current_user.id,
                Course.deleted_at.is_(None)
            )
        )
        course = c_res.scalar_one_or_none()
        if not course:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="COURSE_NOT_FOUND: Khóa học không tồn tại"
            )

        # Lấy danh sách nguồn
        cs_res = await session.execute(
            select(CourseSource.source_id).where(CourseSource.course_id == course_id)
        )
        source_ids = [row[0] for row in cs_res.all()]

        # Lấy danh sách chương và bài học
        chap_res = await session.execute(
            select(Chapter)
            .where(Chapter.course_id == course_id, Chapter.deleted_at.is_(None))
            .order_by(Chapter.position.asc())
        )
        chapters = chap_res.scalars().all()

        chap_responses: List[ChapterResponse] = []
        for chap in chapters:
            les_res = await session.execute(
                select(Lesson)
                .where(Lesson.chapter_id == chap.id, Lesson.deleted_at.is_(None))
                .order_by(Lesson.position.asc())
            )
            lessons = les_res.scalars().all()
            chap_responses.append(ChapterResponse(
                id=chap.id,
                course_id=chap.course_id,
                title=chap.title,
                position=chap.position,
                lessons=[
                    LessonResponse(
                        id=l.id,
                        chapter_id=l.chapter_id,
                        course_id=l.course_id,
                        title=l.title,
                        objective=l.objective,
                        position=l.position,
                        estimated_minutes=l.estimated_minutes,
                        evidence_status=l.evidence_status,
                        origin=l.origin
                    )
                    for l in lessons
                ]
            ))

        return APIResponse(
            success=True,
            data=CourseDetailResponse(
                id=course.id,
                title=course.title,
                description=course.description,
                goal=course.goal,
                target_date=course.target_date,
                status=course.status,
                color=course.color,
                curriculum_revision=course.curriculum_revision,
                last_studied_at=course.last_studied_at,
                created_at=course.created_at,
                updated_at=course.updated_at,
                source_ids=source_ids,
                chapters=chap_responses
            )
        )


@router.post("/{course_id}/curriculum-draft", response_model=APIResponse[CurriculumDraftResponse], status_code=status.HTTP_201_CREATED)
@router.post("/{course_id}/curriculum/draft", response_model=APIResponse[CurriculumDraftResponse], status_code=status.HTTP_201_CREATED)
@router.post("/{course_id}/curriculum/generate", response_model=APIResponse[CurriculumDraftResponse], status_code=status.HTTP_201_CREATED)
async def generate_curriculum_draft(
    course_id: UUID,
    req: GenerateCurriculumDraftRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """AI phân tích học liệu và đề xuất đề cương lộ trình học tập cho khóa học"""
    now = datetime.utcnow()
    draft_id = uuid.uuid4()

    # 1. Kiểm tra khóa học & tài liệu nguồn
    async with scoped_user_session(current_user.id) as session:
        c_res = await session.execute(
            select(Course).where(
                Course.id == course_id,
                Course.owner_id == current_user.id,
                Course.deleted_at.is_(None)
            )
        )
        course = c_res.scalar_one_or_none()
        if not course:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="COURSE_NOT_FOUND: Khóa học không tồn tại"
            )

        # Lấy tiêu đề các tài liệu
        s_res = await session.execute(
            select(Source.title).where(
                Source.id.in_(req.source_ids),
                Source.owner_id == current_user.id
            )
        )
        source_titles = [row[0] for row in s_res.all()]
        base_rev = course.curriculum_revision

    # 2. Gọi Radox AI Gateway để cấu trúc đề cương
    prompt = f"""Hãy đề xuất một đề cương học tập có cấu trúc chi tiết cho khóa học '{course.title}' dựa trên các học liệu sau:
Tài liệu tham khảo: {', '.join(source_titles)}
Kế hoạch học tập: {req.target_weeks} tuần, mỗi tuần {req.hours_per_week} giờ.

Hãy trả về DUY NHẤT một chuỗi JSON chuẩn có cấu trúc như sau (không thêm văn bản thừa hay markdown block):
{{
  "chapters": [
    {{
      "title": "Chương 1: ...",
      "position": 1,
      "lessons": [
        {{
          "title": "Bài 1.1: ...",
          "objective": "Mục tiêu bài học...",
          "estimated_minutes": 45,
          "position": 1
        }}
      ]
    }}
  ]
}}"""

    messages = [
        {"role": "system", "content": "Bạn là chuyên gia sư phạm và thiết kế chương trình học tập CNTT tại Lumi. Hãy trả về JSON hợp lệ."},
        {"role": "user", "content": prompt}
    ]

    try:
        ai_resp = await radox_service.generate_completion(messages)
        # Bóc tách JSON
        ai_resp_clean = ai_resp.strip()
        if ai_resp_clean.startswith("```json"):
            ai_resp_clean = ai_resp_clean[7:]
        if ai_resp_clean.startswith("```"):
            ai_resp_clean = ai_resp_clean[3:]
        if ai_resp_clean.endswith("```"):
            ai_resp_clean = ai_resp_clean[:-3]
        draft_content = json.loads(ai_resp_clean.strip())
    except Exception as e:
        logger.warning(f"Lỗi AI sinh đề cương: {e}, sử dụng cấu trúc mặc định chuẩn")
        draft_content = {
            "chapters": [
                {
                    "title": "Chương 1: Kiến thức nền tảng & Tổng quan",
                    "position": 1,
                    "lessons": [
                        {
                            "title": "Bài 1.1: Giới thiệu chung và mục tiêu môn học",
                            "objective": "Nắm vững các khái niệm cơ bản",
                            "estimated_minutes": 45,
                            "position": 1
                        },
                        {
                            "title": "Bài 1.2: Các phương pháp và nguyên lý cốt lõi",
                            "objective": "Áp dụng vào các bài toán thực tiễn",
                            "estimated_minutes": 60,
                            "position": 2
                        }
                    ]
                },
                {
                    "title": "Chương 2: Kiến trúc nâng cao và Thực hành",
                    "position": 2,
                    "lessons": [
                        {
                            "title": "Bài 2.1: Phân tích chuyên sâu và tối ưu hóa",
                            "objective": "Đánh giá độ phức tạp và hiệu năng",
                            "estimated_minutes": 60,
                            "position": 1
                        }
                    ]
                }
            ]
        }

    # 3. Lưu vào app.curriculum_drafts
    async with scoped_user_session(current_user.id) as session:
        new_draft = CurriculumDraft(
            id=draft_id,
            course_id=course_id,
            owner_id=current_user.id,
            base_curriculum_revision=base_rev,
            status="draft",
            content=draft_content,
            model=radox_service.default_model,
            created_at=now,
            updated_at=now
        )
        session.add(new_draft)
        await session.commit()

        return APIResponse(
            success=True,
            data=CurriculumDraftResponse(
                id=new_draft.id,
                course_id=new_draft.course_id,
                status=new_draft.status,
                content=new_draft.content,
                model=new_draft.model,
                created_at=now
            ),
            message="AI đã tạo bản nháp đề cương khóa học thành công"
        )


from pydantic import BaseModel

class ApplyCurriculumDraftRequest(BaseModel):
    draft_id: UUID


@router.post("/{course_id}/curriculum/apply", response_model=APIResponse[dict])
async def apply_curriculum_draft_alt(
    course_id: UUID,
    req: ApplyCurriculumDraftRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Áp dụng bản nháp đề cương (gửi draft_id trong JSON body)"""
    return await apply_curriculum_draft(course_id=course_id, draft_id=req.draft_id, current_user=current_user)


@router.post("/{course_id}/apply-draft/{draft_id}", response_model=APIResponse[dict])
async def apply_curriculum_draft(
    course_id: UUID,
    draft_id: UUID,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Áp dụng bản nháp đề cương vào khóa học: sinh Chapters và Lessons thực tế trong CSDL"""
    now = datetime.utcnow()

    async with scoped_user_session(current_user.id) as session:
        # 1. Truy vấn khóa học & draft
        c_res = await session.execute(
            select(Course).where(
                Course.id == course_id,
                Course.owner_id == current_user.id,
                Course.deleted_at.is_(None)
            )
        )
        course = c_res.scalar_one_or_none()
        if not course:
            raise HTTPException(status_code=404, detail="COURSE_NOT_FOUND: Khóa học không tồn tại")

        d_res = await session.execute(
            select(CurriculumDraft).where(
                CurriculumDraft.id == draft_id,
                CurriculumDraft.course_id == course_id,
                CurriculumDraft.owner_id == current_user.id
            )
        )
        draft = d_res.scalar_one_or_none()
        if not draft:
            raise HTTPException(status_code=404, detail="DRAFT_NOT_FOUND: Bản nháp không tồn tại")

        content = draft.content or {}
        chapters_data = content.get("chapters", [])

        # 2. Tạo Chapters và Lessons
        created_chapters = 0
        created_lessons = 0

        for chap_data in chapters_data:
            chap_id = uuid.uuid4()
            chapter = Chapter(
                id=chap_id,
                course_id=course_id,
                owner_id=current_user.id,
                title=chap_data.get("title", f"Chương {created_chapters + 1}"),
                position=chap_data.get("position", created_chapters + 1),
                revision=1,
                change_seq=1,
                created_at=now,
                updated_at=now
            )
            session.add(chapter)
            created_chapters += 1

            for les_data in chap_data.get("lessons", []):
                les_id = uuid.uuid4()
                lesson = Lesson(
                    id=les_id,
                    course_id=course_id,
                    chapter_id=chap_id,
                    owner_id=current_user.id,
                    title=les_data.get("title", f"Bài {created_lessons + 1}"),
                    objective=les_data.get("objective"),
                    position=les_data.get("position", created_lessons + 1),
                    estimated_minutes=les_data.get("estimated_minutes", 45),
                    evidence_status="supported",
                    origin="ai",
                    revision=1,
                    change_seq=1,
                    created_at=now,
                    updated_at=now
                )
                session.add(lesson)
                created_lessons += 1

        # 3. Cập nhật trạng thái draft và revision của khóa học
        draft.status = "applied"
        draft.applied_at = now

        await session.execute(
            text("""
                UPDATE app.courses 
                SET curriculum_revision = curriculum_revision + 1,
                    revision = revision + 1,
                    updated_at = now()
                WHERE id = :cid;
            """),
            {"cid": str(course_id)}
        )

        await session.commit()

        return APIResponse(
            success=True,
            data={
                "chapters_created": created_chapters,
                "lessons_created": created_lessons,
                "curriculum_revision": course.curriculum_revision + 1
            },
            message="Đã áp dụng đề cương học tập vào khóa học thành công"
        )


@router.post("/{course_id}/progress/sources/{source_id}", response_model=APIResponse[SourceProgressResponse])
async def update_source_progress(
    course_id: UUID,
    source_id: UUID,
    req: UpdateSourceProgressRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Cập nhật vị trí học liệu nguồn đã đọc của sinh viên"""
    async with scoped_user_session(current_user.id) as session:
        locator_json = json.dumps(req.last_locator) if req.last_locator else None
        sql = text("""
            INSERT INTO app.source_progress (
                owner_id, source_id, source_version_id, last_locator, last_opened_at, revision, change_seq, created_at, updated_at
            )
            VALUES (
                :oid, :sid, :vid, CAST(:loc AS jsonb), now(), 1, 1, now(), now()
            )
            ON CONFLICT (owner_id, source_id) DO UPDATE
            SET last_locator = COALESCE(EXCLUDED.last_locator, app.source_progress.last_locator),
                last_opened_at = now(),
                source_version_id = EXCLUDED.source_version_id,
                revision = app.source_progress.revision + 1,
                updated_at = now()
            RETURNING source_id, source_version_id, last_locator, last_opened_at, updated_at;
        """)

        res = await session.execute(sql, {
            "oid": str(current_user.id),
            "sid": str(source_id),
            "vid": str(req.source_version_id),
            "loc": locator_json
        })
        row = res.mappings().first()
        await session.commit()

        return APIResponse(
            success=True,
            data=SourceProgressResponse(
                source_id=source_id,
                source_version_id=req.source_version_id,
                last_locator=row["last_locator"],
                last_opened_at=row["last_opened_at"],
                updated_at=row["updated_at"]
            ),
            message="Cập nhật tiến độ đọc tài liệu thành công"
        )


@router.post("/{course_id}/progress/lessons/{lesson_id}", response_model=APIResponse[LessonProgressResponse])
async def update_lesson_progress(
    course_id: UUID,
    lesson_id: UUID,
    req: UpdateLessonProgressRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """Cập nhật tiến độ hoàn thành bài học"""
    if req.last_locator is not None and (req.last_source_id is None or req.last_source_version_id is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="VALIDATION_ERROR: Khi cập nhật last_locator cho tiến độ bài học, bắt buộc phải cung cấp cả last_source_id và last_source_version_id"
        )
    if (req.last_source_id is None) != (req.last_source_version_id is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="VALIDATION_ERROR: last_source_id và last_source_version_id phải cùng được cung cấp hoặc cùng để trống"
        )

    async with scoped_user_session(current_user.id) as session:
        completed_at_val = "now()" if req.status == "completed" else "NULL"
        started_at_val = "now()" if req.status in ["in_progress", "completed"] else "NULL"
        locator_json = json.dumps(req.last_locator) if req.last_locator else None

        sql = text(f"""
            INSERT INTO app.lesson_progress (
                owner_id, lesson_id, status, last_source_id, last_source_version_id, last_locator, started_at, completed_at, revision, change_seq, created_at, updated_at
            )
            VALUES (
                :oid, :lid, CAST(:st AS app.lesson_progress_status), :lsid, :lsvid, CAST(:loc AS jsonb), {started_at_val}, {completed_at_val}, 1, 1, now(), now()
            )
            ON CONFLICT (owner_id, lesson_id) DO UPDATE
            SET status = EXCLUDED.status,
                last_source_id = COALESCE(EXCLUDED.last_source_id, app.lesson_progress.last_source_id),
                last_source_version_id = COALESCE(EXCLUDED.last_source_version_id, app.lesson_progress.last_source_version_id),
                last_locator = COALESCE(EXCLUDED.last_locator, app.lesson_progress.last_locator),
                completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN COALESCE(app.lesson_progress.completed_at, now()) ELSE app.lesson_progress.completed_at END,
                revision = app.lesson_progress.revision + 1,
                updated_at = now()
            RETURNING lesson_id, status, last_locator, started_at, completed_at, updated_at;
        """)

        res = await session.execute(sql, {
            "oid": str(current_user.id),
            "lid": str(lesson_id),
            "st": req.status,
            "lsid": str(req.last_source_id) if req.last_source_id else None,
            "lsvid": str(req.last_source_version_id) if req.last_source_version_id else None,
            "loc": locator_json
        })
        row = res.mappings().first()
        await session.commit()

        return APIResponse(
            success=True,
            data=LessonProgressResponse(
                lesson_id=row["lesson_id"],
                status=row["status"],
                last_locator=row["last_locator"],
                started_at=row["started_at"],
                completed_at=row["completed_at"],
                updated_at=row["updated_at"]
            ),
            message="Cập nhật tiến độ bài học thành công"
        )
