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
)

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


def _build_pdf_bytes_from_text(title: str, text_content: Optional[str] = None) -> bytes:
    """Tạo tệp PDF chuẩn nhiều trang bằng PyMuPDF với font Unicode hỗ trợ tiếng Việt đầy đủ."""
    doc = fitz.open()
    body = text_content or (
        f"Chương 1: Cơ sở dữ liệu Quan hệ, Khóa và Ràng buộc ({title})\n\n"
        "1.1. Mô hình Cơ sở dữ liệu Quan hệ và Khóa chính (Primary Key):\n"
        "Khóa chính là một hoặc một tập hợp các thuộc tính giúp xác định duy nhất một bản ghi trong bảng. "
        "Khóa chính không bao giờ được phép nhận giá trị NULL. Mỗi bảng quan hệ chuẩn luôn có một khóa chính "
        "để định danh dữ liệu độc bản.\n\n"
        "1.2. Khóa ngoại (Foreign Key) và Ràng buộc toàn vẹn tham chiếu:\n"
        "Khóa ngoại dùng để liên kết giữa hai bảng và bảo đảm ràng buộc toàn vẹn tham chiếu: mọi giá trị khóa ngoại khác NULL "
        "bắt buộc phải tham chiếu tới một giá trị khóa chính đang tồn tại trong bảng quan hệ cha. "
        "Nhờ đó tránh được hiện tượng dữ liệu mồ côi (orphan records).\n\n"
        "Chương 2: Cây tìm kiếm nhị phân (Binary Search Tree - BST) và Cây cân bằng:\n\n"
        "2.1. Cây tìm kiếm nhị phân (BST):\n"
        "Trong cây tìm kiếm nhị phân, mọi nút bên trái có khóa nhỏ hơn nút cha và mọi nút bên phải có khóa lớn hơn nút cha. "
        "Độ phức tạp tìm kiếm trung bình là O(log n). Tuy nhiên trong trường hợp xấu nhất, cây có thể suy biến thành danh sách liên kết với O(n).\n\n"
        "2.2. Cây Đỏ - Đen (Red-Black Tree) và B-Tree:\n"
        "Cây Đỏ-Đen và B-Tree tự động cân bằng chiều cao ở mức O(log n), giúp hệ quản trị CSDL PostgreSQL tối ưu hóa truy vấn chỉ mục."
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

        page.insert_text((50, 60), f"{title} - Trang {page_num}", fontname=fn, fontsize=14)
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
    1. Tạo Source + SourceVersion + Job trong phiên bảo vệ RLS.
    2. Giải mã PDF thực tế (nếu người dùng chọn tệp .pdf) hoặc tạo PDF từ nội dung văn bản.
    3. Thực thi pipeline B2 (PyMuPDF + FastEmbed 384 chiều + worker_upsert_chunk + complete_ingest_job).
    """
    pdf_bytes: bytes
    if req.pdf_base64:
        try:
            raw_b64 = req.pdf_base64.split(",")[-1]
            pdf_bytes = base64.b64decode(raw_b64)
        except Exception:
            pdf_bytes = _build_pdf_bytes_from_text(req.title, req.text_content)
    else:
        pdf_bytes = _build_pdf_bytes_from_text(req.title, req.text_content)

    kind_normalized = "pdf" if req.kind.lower() in ("pdf", "slide", "docx", "txt", "note") else "pdf"
    source_id = uuid.uuid4()
    version_id = uuid.uuid4()
    storage_path = f"sources/{current_user.id}/{source_id}/{version_id}.pdf"

    # Lưu bản sao tệp PDF cục bộ để trình đọc Web/Desktop hiển thị trực tiếp (iframe/embed)
    try:
        (UPLOADS_DIR / f"{source_id}.pdf").write_bytes(pdf_bytes)
    except Exception as e:
        logger.warning(f"Không thể lưu file PDF cục bộ: {e}")

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


