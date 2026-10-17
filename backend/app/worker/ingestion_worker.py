import asyncio
import logging
import json
from typing import Optional, Dict, Any, List
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal, scoped_worker_session
from app.core.security import supabase_admin
from app.models.source import Source, SourceVersion, SourceChunk, Job
from app.services.pdf_parser import pdf_parser, PDFParseResult
from app.services.embedding_service import embedding_service

logger = logging.getLogger("lumi.worker")


class IngestionWorker:
    """
    Tiến trình xử lý học liệu ngầm của Lumi:
    1. Nhận Job nguyên tử qua app.claim_next_job (Skip Locked + lock_token).
    2. Bóc tách PDF nhận biết đoạn văn qua PyMuPDF.
    3. Sinh vector embeddings (FastEmbed / Google GenAI).
    4. Ghi chunk và vector an toàn vào CSDL (app.worker_upsert_chunk & app.chunk_embeddings).
    5. Kích hoạt phiên bản hoạt động qua app.complete_ingest_job.
    """

    def __init__(self, worker_id: str = "worker_lumi_local"):
        self.worker_id = worker_id

    async def claim_job(self, lease_seconds: int = 300) -> Optional[Dict[str, Any]]:
        """Nhận job tiếp theo trong hàng đợi một cách nguyên tử"""
        async with scoped_worker_session() as session:
            sql = text("SELECT * FROM app.claim_next_job(:w_id, :lease);")
            res = await session.execute(sql, {"w_id": self.worker_id, "lease": lease_seconds})
            row = res.mappings().first()
            if not row or not row.get("id"):
                return None
            return dict(row)

    async def heartbeat(self, job_id: UUID, lock_token: UUID, stage: str, stats: Dict[str, Any], lease_seconds: int = 300):
        """Gia hạn lease định kỳ để tránh bị worker khác reclaim khi file lớn"""
        async with scoped_worker_session() as session:
            sql = text("""
                SELECT app.heartbeat_job(
                    p_job_id := :jid,
                    p_lock_token := :tok,
                    p_stage := CAST(:stg AS app.job_stage),
                    p_stats := CAST(:stats AS jsonb),
                    p_lease_seconds := :lease
                );
            """)
            await session.execute(sql, {
                "jid": str(job_id),
                "tok": str(lock_token),
                "stg": stage,
                "stats": json.dumps(stats),
                "lease": lease_seconds
            })

    async def process_job(self, job_info: Dict[str, Any], pdf_bytes: Optional[bytes] = None) -> bool:
        job_id = job_info["id"]
        lock_token = job_info["lock_token"]
        source_id = job_info["source_id"]
        version_id = job_info["source_version_id"]
        owner_id = job_info["owner_id"]

        logger.info(f"Bắt đầu xử lý Job {job_id} cho source {source_id} (version {version_id})...")

        try:
            # 1. Lấy dữ liệu file PDF
            if pdf_bytes is None:
                # Đọc đường dẫn lưu trữ từ source_versions
                async with scoped_worker_session(user_id=owner_id) as session:
                    res = await session.execute(
                        text("SELECT storage_path FROM app.source_versions WHERE id = :vid;"),
                        {"vid": str(version_id)}
                    )
                    storage_path = res.scalar()

                if not storage_path:
                    raise ValueError(f"Không tìm thấy storage_path cho version {version_id}")

                logger.info(f"Tải tệp từ Supabase Storage: {storage_path}")
                pdf_bytes = supabase_admin.storage.from_("sources").download(storage_path)

            # 2. Bước 1: Trích xuất PDF (Stage: extracting)
            await self.heartbeat(job_id, lock_token, "extracting", {"progress": 10})
            parse_result: PDFParseResult = pdf_parser.parse_pdf(pdf_bytes)
            logger.info(f"Đã phân tích PDF: {parse_result.page_count} trang, {len(parse_result.chunks)} chunks.")

            # 3. Bước 2: Sinh Embeddings (Stage: embedding)
            await self.heartbeat(job_id, lock_token, "embedding", {
                "progress": 40,
                "total_chunks": len(parse_result.chunks),
                "page_count": parse_result.page_count
            })

            chunk_texts = [c.content for c in parse_result.chunks]
            vectors = embedding_service.embed_documents(chunk_texts)
            model_id = embedding_service.model_id
            logger.info(f"Đã sinh {len(vectors)} vector embeddings ({embedding_service.dimensions} dims).")

            # 4. Bước 3: Ghi dữ liệu vào CSDL (Stage: chunking & validating)
            await self.heartbeat(job_id, lock_token, "validating", {"progress": 70})

            async with scoped_worker_session(user_id=owner_id) as session:
                # Ghi từng chunk và vector
                for idx, (chunk, vec) in enumerate(zip(parse_result.chunks, vectors)):
                    # Ghi chunk qua hàm app.worker_upsert_chunk
                    chunk_upsert_sql = text("""
                        SELECT id FROM app.worker_upsert_chunk(
                            p_job_id := :jid,
                            p_lock_token := :tok,
                            p_chunk_index := :c_idx,
                            p_content := :content,
                            p_heading := :heading,
                            p_token_count := :t_count,
                            p_locator := CAST(:locator AS jsonb)
                        );
                    """)
                    c_res = await session.execute(chunk_upsert_sql, {
                        "jid": str(job_id),
                        "tok": str(lock_token),
                        "c_idx": chunk.chunk_index,
                        "content": chunk.content,
                        "heading": chunk.heading,
                        "t_count": chunk.token_count,
                        "locator": json.dumps(chunk.locator)
                    })
                    chunk_id = c_res.scalar()

                    # Ghi vector embedding vào app.chunk_embeddings
                    vec_str = "[" + ",".join(str(f) for f in vec) + "]"
                    vec_sql = text("""
                        INSERT INTO app.chunk_embeddings (
                            chunk_id, embedding_model_id, source_version_id, owner_id, embedding
                        )
                        VALUES (
                            :cid, :mid, :vid, :oid, CAST(:vec AS extensions.vector)
                        )
                        ON CONFLICT (chunk_id, embedding_model_id) DO UPDATE
                        SET embedding = EXCLUDED.embedding;
                    """)
                    await session.execute(vec_sql, {
                        "cid": str(chunk_id),
                        "mid": str(model_id),
                        "vid": str(version_id),
                        "oid": str(owner_id),
                        "vec": vec_str
                    })

                # Ghi cảnh báo (nếu có)
                for w in parse_result.warnings:
                    w_sql = text("""
                        INSERT INTO app.source_warnings (
                            source_version_id, source_id, owner_id, warning_kind, page_number, details
                        )
                        VALUES (:vid, :sid, :oid, CAST(:kind AS app.warning_kind), :page, CAST(:det AS jsonb));
                    """)
                    await session.execute(w_sql, {
                        "vid": str(version_id),
                        "sid": str(source_id),
                        "oid": str(owner_id),
                        "kind": w.warning_kind,
                        "page": w.page_number,
                        "det": json.dumps(w.details)
                    })

                # Cập nhật số trang vào source_versions
                await session.execute(
                    text("UPDATE app.source_versions SET page_count = :pg WHERE id = :vid;"),
                    {"pg": parse_result.page_count, "vid": str(version_id)}
                )

                # 5. Hoàn tất Ingestion Job
                stats_data = {
                    "progress": 100,
                    "pages": parse_result.page_count,
                    "chunks": len(parse_result.chunks),
                    "warnings": len(parse_result.warnings),
                    "embedding_model": str(model_id)
                }
                complete_sql = text("""
                    SELECT * FROM app.complete_ingest_job(
                        p_job_id := :jid,
                        p_lock_token := :tok,
                        p_stats := CAST(:stats AS jsonb)
                    );
                """)
                await session.execute(complete_sql, {
                    "jid": str(job_id),
                    "tok": str(lock_token),
                    "stats": json.dumps(stats_data)
                })

            logger.info(f"Hoàn thành xuất sắc Job {job_id} cho source {source_id}!")
            return True

        except Exception as e:
            logger.error(f"Lỗi khi xử lý Job {job_id}: {e}", exc_info=True)
            async with scoped_worker_session(user_id=owner_id) as session:
                fail_sql = text("""
                    UPDATE app.jobs
                    SET status = 'failed',
                        error_code = 'PROCESSING_ERROR',
                        error_message = :err,
                        finished_at = now()
                    WHERE id = :jid;
                """)
                await session.execute(fail_sql, {"jid": str(job_id), "err": str(e)[:500]})
                # Cập nhật version sang failed
                await session.execute(
                    text("UPDATE app.source_versions SET status = 'failed' WHERE id = :vid;"),
                    {"vid": str(version_id)}
                )
            return False

    async def run_once(self) -> bool:
        """Thực thi một chu kỳ kiểm tra và nhận việc"""
        job = await self.claim_job()
        if not job:
            return False
        return await self.process_job(job)


ingestion_worker = IngestionWorker()
