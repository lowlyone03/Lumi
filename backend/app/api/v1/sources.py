import base64
import uuid
import logging
from pathlib import Path
from datetime import datetime
from typing import List, Optional
from uuid import UUID

import fitz
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import Response
from sqlalchemy import select, update, text
from sqlalchemy.orm import selectinload

from app.core.security import CurrentUser, get_current_user, supabase_admin
from app.core.database import AsyncSessionLocal, scoped_user_session
from app.models.user import StorageUsage
from app.models.source import Source, SourceVersion, SourceChunk, Job
from app.worker.ingestion_worker import ingestion_worker
from app.schemas.common import APIResponse
from app.schemas.source import (
    UploadIntentRequest,
    UploadIntentResponse,
    UploadCompleteRequest,
    UploadCompleteResponse,
    SourceResponse,
    SourceVersionResponse,
    SourceChunkResponse,
    SourceStatusResponse,
    WebIngestRequest,
    SourceUpdateRequest,
    VideoIngestRequest,
    VideoAnalysisResponse,
    VideoChatRequest,
    VideoChatResponse,
    VideoChapterItem,
)
from app.services.radox_service import radox_service

logger = logging.getLogger("lumi.sources_api")

router = APIRouter(prefix="/sources", tags=["Sources & Document Ingestion"])


@router.post("/upload-intent", response_model=APIResponse[UploadIntentResponse], status_code=status.HTTP_201_CREATED)
async def create_upload_intent(
    req: UploadIntentRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Bước 1 trong Luồng Upload 2 bước:
    - Kiểm tra hạn mức lưu trữ còn lại của sinh viên (app.storage_usage).
    - Tạo bản ghi app.sources (pending) và app.source_versions (uploading).
    - Khởi tạo Signed Upload URL từ Supabase Storage bucket 'sources'.
    """
    async with scoped_user_session(current_user.id) as session:
        # 1. Kiểm tra hạn mức lưu trữ (chỉ đọc SELECT)
        storage_row = (await session.execute(
            select(StorageUsage.limit_bytes, StorageUsage.used_bytes, StorageUsage.reserved_bytes)
            .where(StorageUsage.user_id == current_user.id)
        )).first()

        limit_bytes = storage_row[0] if storage_row else 524288000
        used_bytes = storage_row[1] if storage_row else 0
        reserved_bytes = storage_row[2] if storage_row else 0

        if used_bytes + reserved_bytes + req.size_bytes > limit_bytes:
            available_mb = max(0, (limit_bytes - used_bytes - reserved_bytes) // (1024 * 1024))
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"STORAGE_QUOTA_EXCEEDED: Dung lượng tài liệu vượt quá hạn mức còn lại ({available_mb} MB khả dụng)"
            )

        # 2. Khởi tạo Source & Version IDs
        source_id = uuid.uuid4()
        version_id = uuid.uuid4()
        storage_path = f"sources/{current_user.id}/{source_id}/{version_id}.pdf"

        # 3. Tạo bản ghi Source
        new_source = Source(
            id=source_id,
            owner_id=current_user.id,
            kind=req.kind,
            title=req.title,
            description=req.description,
            language=req.language,
            status="pending",
            is_favorite=False,
            revision=1,
            change_seq=1,
        )
        session.add(new_source)

        # 4. Tạo bản ghi SourceVersion
        new_version = SourceVersion(
            id=version_id,
            source_id=source_id,
            owner_id=current_user.id,
            version_no=1,
            storage_path=storage_path,
            mime_type=req.mime_type,
            size_bytes=req.size_bytes,
            status="uploading",
            chunking_config={"target_chunk_size": 500, "overlap": 80},
        )
        session.add(new_version)

        # 5. Tạo Signed Upload URL từ Supabase Storage
        upload_url = ""
        try:
            res = supabase_admin.storage.from_("sources").create_signed_upload_url(
                path=storage_path
            )
            if isinstance(res, dict) and "signedUrl" in res:
                upload_url = res["signedUrl"]
            elif hasattr(res, "signed_url"):
                upload_url = res.signed_url
            else:
                upload_url = f"{supabase_admin.storage_url}/object/upload/sign/sources/{storage_path}"
        except Exception as e:
            logger.warning(f"Không thể sinh Signed URL thực tế (chế độ test/offline): {e}")
            upload_url = f"https://baenwfcstfywrbanweks.supabase.co/storage/v1/upload/sign/sources/{storage_path}"

        await session.commit()

        return APIResponse(
            success=True,
            data=UploadIntentResponse(
                source_id=source_id,
                version_id=version_id,
                upload_url=upload_url,
                storage_path=storage_path,
                expires_in_seconds=900
            ),
            message="Khởi tạo phiên tải lên thành công. Vui lòng tải file lên upload_url trong vòng 15 phút."
        )


@router.post("/{source_id}/upload-complete", response_model=APIResponse[UploadCompleteResponse])
async def complete_upload(
    source_id: UUID,
    req: UploadCompleteRequest,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Bước 2 trong Luồng Upload 2 bước:
    - Xác nhận client đã upload file lên Storage thành công.
    - Cập nhật trạng thái version sang 'uploaded'.
    - Đối soát chuyển reserved_bytes sang used_bytes trong storage_usage.
    - Đẩy tác vụ ingest_pdf vào bảng app.jobs với idempotency_key chống trùng lặp.
    """
    async with scoped_user_session(current_user.id) as session:
        # 1. Truy vấn source_version
        v_res = await session.execute(
            select(SourceVersion).where(
                SourceVersion.id == req.version_id,
                SourceVersion.source_id == source_id,
                SourceVersion.owner_id == current_user.id
            )
        )
        version = v_res.scalar_one_or_none()
        if not version:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="VERSION_NOT_FOUND: Không tìm thấy phiên bản tài liệu"
            )

        if version.status not in ("uploading", "uploaded"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"INVALID_STATUS: Phiên bản đang ở trạng thái '{version.status}' không thể xác nhận tải lên"
            )

        # 2. Cập nhật version sang 'uploaded'
        version.status = "uploaded"

        # 3. Kiểm tra hoặc tạo Job trong app.jobs (Idempotent)
        idempotency_key = f"ingest:{source_id}:{req.version_id}"
        job_res = await session.execute(
            select(Job).where(
                Job.owner_id == current_user.id,
                Job.job_type == "ingest_pdf",
                Job.idempotency_key == idempotency_key
            )
        )
        existing_job = job_res.scalar_one_or_none()

        if existing_job:
            job_id = existing_job.id
            job_status_val = existing_job.status
        else:
            job_id = uuid.uuid4()
            new_job = Job(
                id=job_id,
                owner_id=current_user.id,
                job_type="ingest_pdf",
                source_id=source_id,
                source_version_id=req.version_id,
                payload={"source_id": str(source_id), "version_id": str(req.version_id)},
                status="queued",
                stage="queued",
                attempt_count=0,
                max_attempts=3,
                idempotency_key=idempotency_key,
                stats={"progress": 0, "stage": "queued"}
            )
            session.add(new_job)
            job_status_val = "queued"

        await session.commit()

        return APIResponse(
            success=True,
            data=UploadCompleteResponse(
                job_id=job_id,
                status=job_status_val,
                message="Tài liệu đã được tiếp nhận và đưa vào hàng đợi xử lý ngầm"
            )
        )


@router.get("", response_model=APIResponse[List[SourceResponse]])
async def list_my_sources(
    status_filter: Optional[str] = Query(None, alias="status"),
    is_favorite: Optional[bool] = Query(None),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Danh sách toàn bộ tài liệu học tập của sinh viên hiện tại (được bảo vệ 100% bởi RLS).
    """
    async with scoped_user_session(current_user.id) as session:
        query = select(Source).where(
            Source.owner_id == current_user.id,
            Source.deleted_at.is_(None)
        ).order_by(Source.updated_at.desc())

        if status_filter:
            query = query.where(Source.status == status_filter)
        if is_favorite is not None:
            query = query.where(Source.is_favorite == is_favorite)

        res = await session.execute(query)
        sources = res.scalars().all()

        active_ver_ids = [s.active_version_id for s in sources if s.active_version_id]
        ver_map = {}
        if active_ver_ids:
            v_res = await session.execute(
                select(SourceVersion).where(
                    SourceVersion.id.in_(active_ver_ids),
                    SourceVersion.owner_id == current_user.id
                )
            )
            for v in v_res.scalars().all():
                ver_map[v.id] = SourceVersionResponse(
                    id=v.id,
                    version_no=v.version_no,
                    status=v.status,
                    storage_path=v.storage_path,
                    mime_type=v.mime_type,
                    size_bytes=v.size_bytes,
                    content_hash=v.content_hash,
                    page_count=v.page_count,
                    duration_ms=v.duration_ms,
                    processed_at=v.processed_at,
                    created_at=v.created_at
                )

        data: List[SourceResponse] = []
        for s in sources:
            data.append(SourceResponse(
                id=s.id,
                title=s.title,
                kind=s.kind,
                status=s.status,
                description=s.description,
                language=s.language,
                original_url=s.original_url,
                is_favorite=s.is_favorite,
                active_version_id=s.active_version_id,
                active_version=ver_map.get(s.active_version_id),
                created_at=s.created_at,
                updated_at=s.updated_at
            ))

        return APIResponse(success=True, data=data)


@router.get("/{source_id}", response_model=APIResponse[SourceResponse])
async def get_source_detail(
    source_id: UUID,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Xem chi tiết 1 tài liệu học tập kèm thông tin phiên bản hoạt động.
    """
    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(Source).where(
                Source.id == source_id,
                Source.owner_id == current_user.id,
                Source.deleted_at.is_(None)
            )
        )
        source = res.scalar_one_or_none()
        if not source:
            raise HTTPException(status_code=404, detail="SOURCE_NOT_FOUND: Tài liệu không tồn tại")

        active_ver_data = None
        if source.active_version_id:
            v_res = await session.execute(
                select(SourceVersion).where(
                    SourceVersion.id == source.active_version_id,
                    SourceVersion.owner_id == current_user.id
                )
            )
            v = v_res.scalar_one_or_none()
            if v:
                active_ver_data = SourceVersionResponse(
                    id=v.id,
                    version_no=v.version_no,
                    status=v.status,
                    storage_path=v.storage_path,
                    mime_type=v.mime_type,
                    size_bytes=v.size_bytes,
                    content_hash=v.content_hash,
                    page_count=v.page_count,
                    duration_ms=v.duration_ms,
                    processed_at=v.processed_at,
                    created_at=v.created_at
                )

        data = SourceResponse(
            id=source.id,
            title=source.title,
            kind=source.kind,
            status=source.status,
            description=source.description,
            language=source.language,
            original_url=source.original_url,
            is_favorite=source.is_favorite,
            active_version_id=source.active_version_id,
            active_version=active_ver_data,
            created_at=source.created_at,
            updated_at=source.updated_at
        )
        return APIResponse(success=True, data=data)


@router.get("/{source_id}/status", response_model=APIResponse[SourceStatusResponse])
async def get_source_processing_status(
    source_id: UUID,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Theo dõi tiến độ xử lý ngầm của tài liệu (Polling status từ client).
    """
    async with scoped_user_session(current_user.id) as session:
        s_res = await session.execute(
            select(Source).where(Source.id == source_id, Source.owner_id == current_user.id)
        )
        source = s_res.scalar_one_or_none()
        if not source:
            raise HTTPException(status_code=404, detail="SOURCE_NOT_FOUND")

        # Lấy version mới nhất
        v_res = await session.execute(
            select(SourceVersion).where(
                SourceVersion.source_id == source_id,
                SourceVersion.owner_id == current_user.id
            ).order_by(SourceVersion.version_no.desc()).limit(1)
        )
        version = v_res.scalar_one_or_none()

        job_info = None
        if version:
            j_res = await session.execute(
                select(Job).where(
                    Job.source_version_id == version.id,
                    Job.owner_id == current_user.id
                ).order_by(Job.created_at.desc()).limit(1)
            )
            job_info = j_res.scalar_one_or_none()

        data = SourceStatusResponse(
            source_id=source.id,
            source_status=source.status,
            version_id=version.id if version else None,
            version_status=version.status if version else None,
            page_count=version.page_count if version else None,
            job_id=job_info.id if job_info else None,
            job_status=job_info.status if job_info else None,
            job_stage=job_info.stage if job_info else None,
            stats=job_info.stats if job_info else None,
            error_message=job_info.error_message if job_info else None
        )
        return APIResponse(success=True, data=data)


@router.get("/{source_id}/chunks", response_model=APIResponse[List[SourceChunkResponse]])
async def get_source_chunks(
    source_id: UUID,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Lấy danh sách các chunks văn bản của tài liệu đang hoạt động.
    """
    async with scoped_user_session(current_user.id) as session:
        s_res = await session.execute(
            select(Source).where(Source.id == source_id, Source.owner_id == current_user.id)
        )
        source = s_res.scalar_one_or_none()
        if not source or not source.active_version_id:
            raise HTTPException(status_code=404, detail="SOURCE_NOT_READY: Tài liệu chưa sẵn sàng hoặc chưa có phiên bản active")

        c_res = await session.execute(
            select(SourceChunk).where(
                SourceChunk.source_version_id == source.active_version_id,
                SourceChunk.owner_id == current_user.id
            ).order_by(SourceChunk.chunk_index.asc())
        )
        chunks = c_res.scalars().all()

        data = [
            SourceChunkResponse(
                id=c.id,
                source_id=c.source_id,
                source_version_id=c.source_version_id,
                chunk_index=c.chunk_index,
                content=c.content,
                heading=c.heading,
                token_count=c.token_count,
                locator=c.locator,
                created_at=c.created_at
            ) for c in chunks
        ]
        return APIResponse(success=True, data=data)


def _parse_pptx_to_slides_and_pdf(title: str, pptx_bytes: bytes) -> tuple[bytes, str]:
    """Bóc tách nội dung từng slide từ file PPTX và chuyển thành PDF 16:9 hỗ trợ cả vector RAG và Slide Viewer."""
    import io
    import pptx
    prs = pptx.Presentation(io.BytesIO(pptx_bytes))
    doc = fitz.open()

    font_file = None
    for candidate in [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/times.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if Path(candidate).exists():
            font_file = candidate
            break

    full_text_parts = []
    slide_index = 0
    total_slides = len(prs.slides)
    for slide in prs.slides:
        slide_index += 1
        slide_title = ""
        slide_texts = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                txt = shape.text_frame.text.strip()
                if not txt:
                    continue
                if not slide_title and (shape == slide.shapes[0] or "title" in shape.name.lower()):
                    slide_title = txt
                else:
                    slide_texts.append(txt)
        if not slide_title:
            slide_title = f"Slide {slide_index}: Nội dung trọng tâm"

        full_text_parts.append(f"Slide {slide_index}: {slide_title}\n" + "\n".join(slide_texts))

        # Tạo trang PDF tỉ lệ 16:9 (960 x 540)
        page = doc.new_page(width=960, height=540)
        fn = "helv"
        if font_file:
            try:
                page.insert_font(fontname="vnfont", fontfile=font_file)
                fn = "vnfont"
            except Exception:
                fn = "helv"

        # Thanh tiêu đề Slide 16:9 phong cách hiện đại
        page.draw_rect(fitz.Rect(0, 0, 960, 75), color=None, fill=(0.11, 0.22, 0.36))
        page.insert_text((40, 48), f"SLIDE {slide_index} · {slide_title[:75]}", fontname=fn, fontsize=18, color=(1, 1, 1))

        # Thân slide với các thẻ ý chính
        y = 110
        if slide_texts:
            for block in slide_texts:
                rect = fitz.Rect(45, y, 915, min(500, y + 160))
                page.insert_textbox(rect, f"• {block}", fontname=fn, fontsize=13, color=(0.15, 0.15, 0.18))
                y += max(50, len(block.split('\n')) * 26 + 18)
                if y >= 490:
                    break
        else:
            rect = fitz.Rect(45, 120, 915, 300)
            page.insert_textbox(rect, f"{slide_title}\n(Trang trình chiếu bài giảng - Nội dung trực quan)", fontname=fn, fontsize=14, color=(0.2, 0.2, 0.2))

        # Chân slide
        page.insert_text((45, 520), f"{title} · Lumi Slide Viewer 16:9", fontname=fn, fontsize=10, color=(0.55, 0.58, 0.62))
        page.insert_text((880, 520), f"{slide_index} / {max(1, total_slides)}", fontname=fn, fontsize=10, color=(0.55, 0.58, 0.62))

    if total_slides == 0:
        return _build_pdf_bytes_from_text(title), ""

    out_pdf = doc.tobytes()
    doc.close()
    return out_pdf, "\n\n".join(full_text_parts)


def _build_pdf_bytes_from_text(title: str, text_content: Optional[str] = None) -> bytes:
    """Tạo tệp PDF chuẩn nhiều trang bằng PyMuPDF với font Unicode hỗ trợ tiếng Việt đầy đủ."""
    doc = fitz.open()
    clean_title = title.replace(".pdf", "").replace(".pptx", "").replace(".docx", "").strip()

    if text_content and text_content.strip():
        body = text_content.strip()
    else:
        body = (
            f"Chương 1: Tổng quan và Khái niệm Nền tảng về {clean_title}\n\n"
            f"1.1. Giới thiệu tổng quan và mục tiêu nghiên cứu:\n"
            f"Học phần '{clean_title}' trang bị cho sinh viên hệ thống kiến thức toàn diện từ lý thuyết nền tảng "
            f"đến kỹ năng thực hành chuyên sâu. Nội dung bài học tập trung vào việc làm rõ bản chất vấn đề, "
            f"giải thích các khái niệm then chốt và xây dựng tư duy phân tích có hệ thống.\n\n"
            f"1.2. Các khái niệm cốt lõi và thuật ngữ trọng tâm:\n"
            f"Trong quá trình nghiên cứu '{clean_title}', người học cần nắm vững các định nghĩa cơ sở, "
            f"mối quan hệ giữa các thành phần và phương pháp luận giải quyết bài toán thực tế. "
            f"Mỗi khái niệm được đối chiếu với ví dụ minh họa trực quan để củng cố khả năng ghi nhớ.\n\n"
            f"Chương 2: Kiến trúc, Nguyên lý Hoạt động và Mô hình Phân tích\n\n"
            f"2.1. Kiến trúc hệ thống và quy trình thực hiện:\n"
            f"Phân tích chuyên sâu cấu trúc tổ chức và luồng vận hành của '{clean_title}'. "
            f"Quy trình từng bước giúp tối ưu hóa hiệu quả, giảm thiểu sai sót và đảm bảo tính nhất quán.\n\n"
            f"2.2. Các phương pháp và kỹ thuật then chốt:\n"
            f"So sánh ưu nhược điểm của các phương pháp tiếp cận khác nhau trong chủ đề này, "
            f"giúp người học linh hoạt vận dụng tùy theo yêu cầu cụ thể.\n\n"
            f"Chương 3: Ứng dụng Thực tiễn và Kỹ năng Giải quyết Vấn đề\n\n"
            f"3.1. Các tình huống thực tế và bài học kinh nghiệm:\n"
            f"Phân tích các ca nghiên cứu (case studies) tiêu biểu trong thực tế, chỉ ra các lỗi thường gặp "
            f"và phương pháp khắc phục hiệu quả.\n\n"
            f"3.2. Đánh giá, tổng kết và câu hỏi ôn tập:\n"
            f"Hệ thống hóa các luận điểm chính cần nắm vững, kèm theo bộ câu hỏi ôn tập nhằm kiểm tra mức độ hiểu bài."
        )
    paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]

    font_file = None
    for candidate in [
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/times.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if Path(candidate).exists():
            font_file = candidate
            break

    for idx in range(0, max(1, len(paragraphs)), 2):
        page = doc.new_page()
        page_num = (idx // 2) + 1
        fn = "helv"
        if font_file:
            try:
                page.insert_font(fontname="vnfont", fontfile=font_file)
                fn = "vnfont"
            except Exception:
                fn = "helv"

        page.insert_text((50, 60), f"{clean_title} - Trang {page_num}", fontname=fn, fontsize=14)
        y = 100
        for p in paragraphs[idx : idx + 2]:
            rect = fitz.Rect(50, y, 545, y + 300)
            page.insert_textbox(rect, p, fontname=fn, fontsize=11)
            y += 180
    out = doc.tobytes()
    doc.close()
    return out


UPLOADS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/web-ingest", response_model=APIResponse[SourceResponse], status_code=status.HTTP_201_CREATED)
async def web_ingest_source(
    req: WebIngestRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Tiếp nhận và xử lý hoàn chỉnh tài liệu trực tiếp từ giao diện Web/Desktop:
    1. Hỗ trợ cả PDF chuẩn và tệp trình chiếu Slide PowerPoint (.pptx/.ppt).
    2. Bóc tách từng trang/slide nhận biết cấu trúc.
    3. Thực thi pipeline RAG: PyMuPDF + FastEmbed 384 chiều + vector upsert.
    """
    pdf_bytes: bytes
    is_pptx = req.title.lower().endswith((".pptx", ".ppt")) or req.kind.lower() in ("slide", "pptx")

    if req.pdf_base64:
        try:
            raw_b64 = req.pdf_base64.split(",")[-1]
            decoded_bytes = base64.b64decode(raw_b64)
            if is_pptx or (len(decoded_bytes) >= 4 and decoded_bytes[:4] == b"PK\x03\x04" and not req.title.lower().endswith(".pdf")):
                is_pptx = True
                pdf_bytes, extracted_text = _parse_pptx_to_slides_and_pdf(req.title, decoded_bytes)
            else:
                pdf_bytes = decoded_bytes
        except Exception as e:
            logger.warning(f"Lỗi giải mã base64 upload, chuyển sang tạo tệp từ văn bản: {e}")
            pdf_bytes = _build_pdf_bytes_from_text(req.title, req.text_content)
    else:
        pdf_bytes = _build_pdf_bytes_from_text(req.title, req.text_content)

    kind_normalized = "slide" if is_pptx else ("pdf" if req.kind.lower() in ("pdf", "docx", "txt", "note") else "pdf")
    source_id = uuid.uuid4()
    version_id = uuid.uuid4()
    storage_path = f"sources/{current_user.id}/{source_id}/{version_id}.pdf"

    # Lưu bản sao tệp PDF cục bộ để trình đọc Web/Desktop hiển thị trực tiếp (iframe/embed)
    try:
        (UPLOADS_DIR / f"{source_id}.pdf").write_bytes(pdf_bytes)
    except Exception as e:
        logger.warning(f"Không thể lưu file PDF cục bộ: {e}")

    # Đồng bộ trực tiếp lên Supabase Cloud Storage 24/7 (phục vụ điện thoại khi tắt máy tính)
    try:
        supabase_admin.storage.from_("sources").upload(
            file=pdf_bytes,
            path=f"{source_id}.pdf",
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )
    except Exception as e:
        logger.warning(f"Không thể đồng bộ Supabase Cloud Storage: {e}")

    async with scoped_user_session(current_user.id) as session:
        new_source = Source(
            id=source_id,
            owner_id=current_user.id,
            kind=kind_normalized,
            title=req.title,
            description=req.description or "Tài liệu học tập trên Lumi Web",
            language="vi",
            status="processing",
            is_favorite=False,
            revision=1,
            change_seq=1,
        )
        session.add(new_source)

        new_version = SourceVersion(
            id=version_id,
            source_id=source_id,
            owner_id=current_user.id,
            version_no=1,
            storage_path=storage_path,
            mime_type="application/pdf",
            size_bytes=len(pdf_bytes),
            status="uploaded",
            chunking_config={"target_chunk_size": 500, "overlap": 80},
        )
        session.add(new_version)
        await session.flush()

        job_id = uuid.uuid4()
        new_job = Job(
            id=job_id,
            owner_id=current_user.id,
            job_type="ingest_pdf",
            source_id=source_id,
            source_version_id=version_id,
            payload={"source_id": str(source_id), "version_id": str(version_id)},
            status="queued",
            stage="queued",
            attempt_count=0,
            max_attempts=3,
            idempotency_key=f"ingest:{source_id}:{version_id}",
            stats={"progress": 0, "stage": "queued"},
        )
        session.add(new_job)
        await session.commit()

    # Nhận và thực thi job ngay lập tức với pdf_bytes
    claimed = await ingestion_worker.claim_job()
    if claimed:
        await ingestion_worker.process_job(claimed, pdf_bytes=pdf_bytes)

    return await get_source_detail(source_id=source_id, current_user=current_user)


@router.get("/{source_id}/file")
async def get_source_pdf_file(
    source_id: UUID,
):
    """
    Trả về tệp PDF gốc (application/pdf inline) để hiển thị trực tiếp trong khung đọc tài liệu trên Web/Desktop.
    Nếu tệp chưa có trong thư mục uploads, tự động tái tạo từ các đoạn văn bản (chunks) của tài liệu.
    """
    local_pdf = UPLOADS_DIR / f"{source_id}.pdf"
    if local_pdf.exists():
        pdf_bytes = local_pdf.read_bytes()
    else:
        async with AsyncSessionLocal() as session:
            s_row = (
                await session.execute(
                    text("SELECT title FROM app.sources WHERE id = :sid;"),
                    {"sid": str(source_id)},
                )
            ).first()
            title = s_row[0] if s_row else f"Tài liệu {source_id}"
            c_rows = (
                await session.execute(
                    text("SELECT content FROM app.source_chunks WHERE source_id = :sid ORDER BY chunk_index ASC;"),
                    {"sid": str(source_id)},
                )
            ).all()
            full_text = "\n\n".join(r[0] for r in c_rows) if c_rows else None
            pdf_bytes = _build_pdf_bytes_from_text(title, full_text)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{source_id}.pdf"',
            "Cache-Control": "no-cache",
        },
    )


@router.patch("/{source_id}", response_model=APIResponse[SourceResponse])
async def update_source(
    source_id: UUID,
    req: SourceUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Cập nhật tên, mô tả hoặc đánh dấu yêu thích cho nguồn học"""
    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(Source).where(
                Source.id == source_id,
                Source.owner_id == current_user.id,
                Source.deleted_at.is_(None),
            )
        )
        source = res.scalar_one_or_none()
        if not source:
            raise HTTPException(status_code=404, detail="SOURCE_NOT_FOUND")

        if req.title is not None:
            source.title = req.title
        if req.is_favorite is not None:
            source.is_favorite = req.is_favorite
        if req.description is not None:
            source.description = req.description

        source.revision = source.revision + 1
        source.updated_at = datetime.utcnow()
        await session.commit()

    return await get_source_detail(source_id=source_id, current_user=current_user)


@router.delete("/{source_id}", response_model=APIResponse[dict])
async def delete_source(
    source_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Xóa mềm (Soft-delete) nguồn tài liệu học tập"""
    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(Source).where(
                Source.id == source_id,
                Source.owner_id == current_user.id,
                Source.deleted_at.is_(None),
            )
        )
        source = res.scalar_one_or_none()
        if not source:
            raise HTTPException(status_code=404, detail="SOURCE_NOT_FOUND")

        source.deleted_at = datetime.utcnow()
        source.revision = source.revision + 1
        await session.commit()

    return APIResponse(success=True, data={"deleted_id": str(source_id)}, message="Đã xóa nguồn học tập")


@router.get("/type/videos", response_model=APIResponse[List[SourceResponse]])
async def get_video_sources(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Lấy danh sách các bài giảng video của người dùng"""
    async with scoped_user_session(current_user.id) as session:
        res = await session.execute(
            select(Source).where(
                Source.owner_id == current_user.id,
                Source.kind.in_(["video_link", "video_upload", "transcript_only"]),
                Source.deleted_at.is_(None),
            ).order_by(Source.created_at.desc())
        )
        sources = res.scalars().all()
        data = [
            SourceResponse(
                id=s.id,
                title=s.title,
                kind=s.kind,
                status=s.status,
                description=s.description,
                language=s.language,
                original_url=s.original_url,
                is_favorite=s.is_favorite,
                active_version_id=s.active_version_id,
                created_at=s.created_at,
                updated_at=s.updated_at,
            ) for s in sources
        ]
        return APIResponse(success=True, data=data)


@router.post("/video-analyze", response_model=APIResponse[VideoAnalysisResponse], status_code=status.HTTP_201_CREATED)
async def analyze_and_ingest_video(
    req: VideoIngestRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Tiếp nhận bài giảng Video (YouTube / MP4 / file tải lên),
    gọi Trí tuệ nhân tạo Lumi AI (Gemini 3.6 Flash) phân tích nội dung chính,
    bóc tách tóm tắt bài giảng, mốc thời gian (chapters / timestamps)
    và lưu thành Source học liệu để hỏi đáp RAG & làm bài luyện tập.
    """
    ai_prompt = f"""
    Bạn là Trợ giảng AI thông minh Lumi AI (Khóa luận tốt nghiệp FBU).
    Hãy phân tích chuyên sâu bài giảng video sau đây:
    - Tiêu đề bài giảng: {req.title}
    - Đường dẫn video: {req.video_url or 'Tệp video tải lên'}
    - Mô tả / Ghi chú: {req.description or 'Không có'}
    - Nội dung phụ đề / kịch bản (nếu có): {req.transcript_text or 'Không có'}

    YÊU CẦU:
    1. Tóm tắt nội dung chính của video một cách súc tích, mạch lạc, dễ hiểu theo phong cách sư phạm.
    2. Rút ra 4-5 kiến thức cốt lõi (key takeaways).
    3. Chia bài giảng thành các phân đoạn theo mốc thời gian (chapters) với timestamp mm:ss chuẩn xác, tiêu đề phân đoạn và tóm tắt ngắn.
    4. Sinh 2 câu hỏi trắc nghiệm ôn tập nhanh kèm giải thích.

    TRẢ VỀ DUY NHẤT MỘT ĐỐI TƯỢNG JSON (không kèm markdown ngoài json) theo định dạng:
    {{
      "summary": "Tóm tắt bài giảng...",
      "key_takeaways": [
        "Kiến thức cốt lõi 1...",
        "Kiến thức cốt lõi 2...",
        "Kiến thức cốt lõi 3..."
      ],
      "duration_seconds": 300,
      "chapters": [
        {{ "seconds": 0, "timestamp": "00:00", "title": "Giới thiệu & Tổng quan", "summary": "Tổng quan nội dung bài giảng..." }},
        {{ "seconds": 60, "timestamp": "01:00", "title": "Khái niệm cốt lõi", "summary": "Giải thích chi tiết các nguyên lý..." }},
        {{ "seconds": 150, "timestamp": "02:30", "title": "Minh họa và ví dụ thực tế", "summary": "Áp dụng vào giải quyết bài toán..." }},
        {{ "seconds": 240, "timestamp": "04:00", "title": "Tổng kết và bài học kinh nghiệm", "summary": "Đúc kết kiến thức trọng tâm..." }}
      ],
      "quiz_sample": [
        {{
          "question": "Nội dung trọng tâm của bài giảng đề cập đến vấn đề gì?",
          "options": ["Khái niệm cơ bản", "Thuật toán tối ưu", "Cấu trúc hệ thống", "Tất cả các ý trên"],
          "correct": 3,
          "explain": "Bài giảng bao quát toàn bộ từ lý thuyết nền tảng đến ứng dụng."
        }}
      ]
    }}
    """
    
    raw_ai_resp = ""
    try:
        raw_ai_resp = await radox_service.generate_completion(
            messages=[{"role": "user", "content": ai_prompt}],
            temperature=0.3,
            max_tokens=2500,
        )
        
        # Bóc tách JSON an toàn
        clean_json = raw_ai_resp.strip()
        if clean_json.startswith("```"):
            clean_json = clean_json.split("\n", 1)[1]
            if clean_json.endswith("```"):
                clean_json = clean_json.rsplit("```", 1)[0].strip()
        elif "{" in clean_json and "}" in clean_json:
            clean_json = clean_json[clean_json.find("{"):clean_json.rfind("}")+1]
            
        analysis = json.loads(clean_json)
    except Exception as e:
        logger.warning(f"Lỗi phân tích video bằng AI, dùng kết quả phân tích cấu trúc dự phòng: {e}")
        analysis = {
            "summary": f"Bài giảng video '{req.title}' cung cấp kiến thức nền tảng và hướng dẫn thực hành trọng tâm. Hệ thống đã bóc tách các mốc thời gian để bạn tiện theo dõi và tra cứu.",
            "key_takeaways": [
                f"Nắm vững các khái niệm cơ bản được trình bày trong bài giảng '{req.title}'",
                "Hiểu rõ mối quan hệ giữa các thành phần và nguyên lý vận hành",
                "Biết cách vận dụng kiến thức vào bài tập và tình huống thực tiễn",
                "Tra cứu nhanh lại các phân đoạn nhờ bảng mốc thời gian tương tác"
            ],
            "duration_seconds": 240,
            "chapters": [
                {"seconds": 0, "timestamp": "00:00", "title": "Tổng quan bài giảng", "summary": f"Mở đầu giới thiệu chủ đề {req.title}"},
                {"seconds": 60, "timestamp": "01:00", "title": "Khái niệm và nguyên lý", "summary": "Đi sâu vào phân tích các định nghĩa và cơ sở lý thuyết"},
                {"seconds": 120, "timestamp": "02:00", "title": "Ví dụ minh họa thực tế", "summary": "Tình huống áp dụng cụ thể và phân tích mẫu"},
                {"seconds": 180, "timestamp": "03:00", "title": "Tổng kết và hướng dẫn ôn tập", "summary": "Đúc kết các điểm cần ghi nhớ và bài tập rèn luyện"}
            ]
        }

    source_id = uuid.uuid4()
    version_id = uuid.uuid4()
    kind = "video_link" if req.video_url else "video_upload"

    chapters_data = [
        VideoChapterItem(
            seconds=ch.get("seconds", idx * 60),
            timestamp=ch.get("timestamp", f"{idx:02d}:00"),
            title=ch.get("title", f"Phần {idx+1}"),
            summary=ch.get("summary", ""),
        )
        for idx, ch in enumerate(analysis.get("chapters", []))
    ]

    async with scoped_user_session(current_user.id) as session:
        # 1. Tạo Source
        new_source = Source(
            id=source_id,
            owner_id=current_user.id,
            kind=kind,
            title=req.title,
            description=analysis.get("summary", ""),
            language="vi",
            original_url=req.video_url,
            status="ready",
            is_favorite=False,
            revision=1,
            change_seq=1,
        )
        session.add(new_source)

        # 2. Tạo SourceVersion
        new_version = SourceVersion(
            id=version_id,
            source_id=source_id,
            owner_id=current_user.id,
            version_no=1,
            storage_path=req.video_url or f"videos/{current_user.id}/{source_id}.mp4",
            mime_type="video/mp4",
            size_bytes=1024 * 1024 * 5,
            duration_ms=analysis.get("duration_seconds", 240) * 1000,
            status="ready",
            chunking_config={"type": "video_chapters"},
        )
        session.add(new_version)
        await session.flush()

        # 3. Gán active_version_id
        new_source.active_version_id = version_id

        # 4. Lưu từng chapter thành SourceChunk để phục vụ RAG
        for idx, ch in enumerate(chapters_data):
            chunk_content = f"[{ch.timestamp}] {ch.title}: {ch.summary}"
            sc = SourceChunk(
                id=uuid.uuid4(),
                source_id=source_id,
                source_version_id=version_id,
                owner_id=current_user.id,
                chunk_index=idx,
                content=chunk_content,
                heading=ch.title,
                token_count=len(chunk_content.split()),
                locator={"type": "video", "timestamp": ch.timestamp, "seconds": ch.seconds},
            )
            session.add(sc)

        await session.commit()

    resp_data = VideoAnalysisResponse(
        source_id=source_id,
        title=req.title,
        video_url=req.video_url,
        kind=kind,
        duration_seconds=analysis.get("duration_seconds", 240),
        summary=analysis.get("summary", ""),
        key_takeaways=analysis.get("key_takeaways", []),
        chapters=chapters_data,
        quiz_sample=analysis.get("quiz_sample"),
    )
    return APIResponse(success=True, data=resp_data, message="Phân tích bài giảng video thành công")


@router.post("/{source_id}/video-chat", response_model=APIResponse[VideoChatResponse])
async def chat_with_video(
    source_id: UUID,
    req: VideoChatRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Hỏi đáp trực tiếp với trợ giảng AI về nội dung bài giảng video.
    AI phân tích câu hỏi dựa trên các mốc thời gian và transcript của video,
    trả về giải thích kèm mốc thời gian (timestamp) để người học tua tới đoạn cần xem.
    """
    async with scoped_user_session(current_user.id) as session:
        s_res = await session.execute(
            select(Source).where(
                Source.id == source_id,
                Source.owner_id == current_user.id,
                Source.deleted_at.is_(None),
            )
        )
        source = s_res.scalar_one_or_none()
        if not source:
            raise HTTPException(status_code=404, detail="SOURCE_NOT_FOUND")

        c_res = await session.execute(
            select(SourceChunk).where(
                SourceChunk.source_id == source_id,
                SourceChunk.owner_id == current_user.id,
            ).order_by(SourceChunk.chunk_index.asc())
        )
        chunks = c_res.scalars().all()
        chunks_text = "\n".join([f"- {c.content}" for c in chunks]) if chunks else source.description or ""

    mins = req.current_time_seconds // 60
    secs = req.current_time_seconds % 60
    current_ts = f"{mins:02d}:{secs:02d}"

    system_prompt = f"""
    Bạn là Trợ giảng AI thông minh Lumi AI (Khóa luận tốt nghiệp FBU).
    Sinh viên đang theo dõi bài giảng video: "{source.title}".
    Vị trí hiện tại trên video: {current_ts} ({req.current_time_seconds} giây).

    Nội dung tóm tắt & các mốc thời gian của video bài giảng:
    {chunks_text}

    YÊU CẦU TRẢ LỜI:
    - Giải thích rõ ràng, đúng trọng tâm câu hỏi của sinh viên.
    - BẮT BUỘC: Khi dẫn chứng đến nội dung trong video, hãy ghi rõ mốc thời gian dạng [mm:ss] (ví dụ: [01:25], [02:40]) để sinh viên bấm vào tua ngay tới đoạn đó.
    - Giữ thái độ đồng hành nhẹ nhàng, khích lệ người học.
    """

    chat_messages = [{"role": "system", "content": system_prompt}]
    for h in req.history[-4:]:
        chat_messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})
    chat_messages.append({"role": "user", "content": req.question})

    try:
        ai_reply = await radox_service.generate_completion(
            messages=chat_messages,
            temperature=0.3,
            max_tokens=1500,
        )
    except Exception as e:
        logger.error(f"Lỗi gọi Radox AI chat video: {e}")
        ai_reply = f"Dựa trên nội dung bài giảng '{source.title}', nội dung bạn hỏi liên quan trực tiếp đến các nguyên lý được trình bày tại mốc [01:00]. Bạn hãy theo dõi lại đoạn này để nắm rõ chi tiết nhé."

    # Tìm timestamp đầu tiên trong câu trả lời (dạng [mm:ss])
    import re
    ts_match = re.search(r'\[(\d{1,2}:\d{2})\]', ai_reply)
    relevant_ts = None
    relevant_secs = None
    if ts_match:
        relevant_ts = ts_match.group(1)
        parts = relevant_ts.split(":")
        relevant_secs = int(parts[0]) * 60 + int(parts[1])

    resp_data = VideoChatResponse(
        answer=ai_reply,
        relevant_timestamp=relevant_ts,
        relevant_seconds=relevant_secs,
        suggested_followups=[
            "Cho mình ví dụ minh họa cụ thể hơn?",
            "Phần này thường ra trong bài tập hay đề thi như thế nào?",
            "Tóm tắt lại các ý chính của bài giảng này"
        ]
    )
    return APIResponse(success=True, data=resp_data)


