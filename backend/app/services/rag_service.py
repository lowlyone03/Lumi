import logging
import re
from typing import List, Dict, Any, Optional, Tuple
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.embedding_service import embedding_service

logger = logging.getLogger("lumi.rag_service")


class RetrievedChunk:
    def __init__(
        self,
        chunk_id: UUID,
        source_id: UUID,
        source_version_id: UUID,
        chunk_index: int,
        heading: Optional[str],
        content: str,
        locator: Dict[str, Any],
        vector_score: float,
        keyword_score: float,
        combined_score: float,
    ):
        self.chunk_id = chunk_id
        self.source_id = source_id
        self.source_version_id = source_version_id
        self.chunk_index = chunk_index
        self.heading = heading or ""
        self.content = content
        self.locator = locator
        self.vector_score = vector_score
        self.keyword_score = keyword_score
        self.combined_score = combined_score


class RAGService:
    """
    Dịch vụ truy xuất RAG Hybrid (Vector + Keyword + RRF) cho Lumi:
    1. Sinh vector câu hỏi bằng FastEmbed (384 dims).
    2. Gọi hàm SQL app.match_chunks kết hợp tìm kiếm ngữ nghĩa và Full-Text Search.
    3. Xây dựng prompt có ngữ cảnh học liệu và đối soát trích dẫn.
    """

    SYSTEM_PROMPT = """Bạn là Lumi — Trợ giảng AI học tập thông minh, thân thiện và chuẩn mực sư phạm dành cho sinh viên đại học.

Nhiệm vụ của bạn:
1. Nếu sinh viên chào hỏi xã giao (ví dụ: "xin chào", "chào Lumi", "bạn có thể giúp gì?") hoặc hỏi cách học, hãy chào lại thật tự nhiên, ấm áp và giới thiệu ngắn gọn cách bạn có thể hỗ trợ giải thích tài liệu, tóm tắt ý chính, tạo câu hỏi trắc nghiệm và thẻ ghi nhớ từ tài liệu đang mở.
2. Khi sinh viên hỏi về nội dung bài học hoặc yêu cầu tóm tắt/giải thích tài liệu, hãy trả lời chi tiết, rõ ràng, trình bày khoa học bằng gạch đầu dòng DỰA TRÊN các đoạn học liệu được cung cấp dưới đây.
3. Khi sử dụng thông tin từ đoạn học liệu nào, bạn BẮT BUỘC phải trích dẫn số thứ tự nguồn tương ứng ở cuối câu hoặc đoạn, ví dụ: "Sinh viên thực tập tốt nghiệp cần hoàn thành 02 sản phẩm gồm Báo cáo thực tập tổng hợp và Khóa luận tốt nghiệp [1]."
4. Nếu câu hỏi chuyên môn nằm ngoài phạm vi tài liệu đang mở, hãy thông báo nhẹ nhàng: "Tài liệu học tập hiện tại chưa đề cập chi tiết về vấn đề này." Sau đó giải thích bổ sung ngắn gọn, chính xác dựa trên kiến thức học thuật chuẩn."""

    async def retrieve_chunks(
        self,
        session: AsyncSession,
        source_ids: List[UUID],
        query_text: str,
        match_count: int = 5,
        rrf_k: int = 60,
    ) -> List[RetrievedChunk]:
        """Truy xuất các chunk tài liệu liên quan nhất qua hàm CSDL app.match_chunks"""
        if not source_ids or not query_text.strip():
            return []

        # 1. Sinh vector nhúng câu hỏi (384 chiều)
        query_vec = embedding_service.embed_query(query_text)
        vec_str = "[" + ",".join(str(f) for f in query_vec) + "]"
        model_id = embedding_service.model_id

        # 2. Gọi hàm SQL app.match_chunks
        sql = text("""
            SELECT 
                chunk_id,
                source_id,
                source_version_id,
                chunk_index,
                heading,
                content,
                locator,
                vector_score,
                keyword_score,
                combined_score
            FROM app.match_chunks(
                p_requested_source_ids := :sids,
                p_query_text := :qtext,
                p_query_embedding := CAST(:qvec AS extensions.vector),
                p_embedding_model_id := :mid,
                p_method := 'hybrid'::app.retrieval_method,
                p_match_count := :mcount,
                p_rrf_k := :rrfk
            );
        """)

        res = await session.execute(sql, {
            "sids": [str(s) for s in source_ids],
            "qtext": query_text,
            "qvec": vec_str,
            "mid": str(model_id),
            "mcount": match_count,
            "rrfk": rrf_k
        })

        rows = res.fetchall()
        chunks: List[RetrievedChunk] = []
        for r in rows:
            chunks.append(RetrievedChunk(
                chunk_id=r.chunk_id,
                source_id=r.source_id,
                source_version_id=r.source_version_id,
                chunk_index=r.chunk_index,
                heading=r.heading,
                content=r.content,
                locator=r.locator or {},
                vector_score=float(r.vector_score) if r.vector_score is not None else 0.0,
                keyword_score=float(r.keyword_score) if r.keyword_score is not None else 0.0,
                combined_score=float(r.combined_score) if r.combined_score is not None else 0.0,
            ))

        # Hỗ trợ truy vấn theo số trang cụ thể (ví dụ: "Trang 1", "Trang 3") hoặc câu hỏi tóm tắt toàn tài liệu
        page_match = re.search(r"trang\s+(\d+)", query_text, re.IGNORECASE)
        if page_match or not chunks:
            target_page = int(page_match.group(1)) if page_match else None
            fb_sql = text("""
                SELECT id AS chunk_id, source_id, source_version_id, chunk_index, heading, content, locator
                FROM app.source_chunks
                WHERE source_id = ANY(CAST(:sids AS uuid[]))
                ORDER BY chunk_index ASC
                LIMIT 20;
            """)
            fb_res = await session.execute(fb_sql, {"sids": [str(s) for s in source_ids]})
            fb_rows = fb_res.fetchall()
            existing_ids = {c.chunk_id for c in chunks}
            prioritized: List[RetrievedChunk] = []
            fallback_list: List[RetrievedChunk] = []
            for r in fb_rows:
                rc = RetrievedChunk(
                    chunk_id=r.chunk_id,
                    source_id=r.source_id,
                    source_version_id=r.source_version_id,
                    chunk_index=r.chunk_index,
                    heading=r.heading,
                    content=r.content,
                    locator=r.locator or {},
                    vector_score=0.8,
                    keyword_score=0.8,
                    combined_score=0.8,
                )
                if target_page and (r.locator or {}).get("page") == target_page:
                    prioritized.append(rc)
                elif r.chunk_id not in existing_ids:
                    fallback_list.append(rc)

            if prioritized:
                chunks = prioritized + [c for c in chunks if c.chunk_id not in {p.chunk_id for p in prioritized}]
                chunks = chunks[:match_count]
            elif not chunks and fallback_list:
                chunks = fallback_list[:match_count]

        logger.info(f"RAG Match Chunks: tìm thấy {len(chunks)} chunks cho truy vấn '{query_text[:40]}...'")
        return chunks

    def build_prompt_messages(
        self,
        query_text: str,
        retrieved_chunks: List[RetrievedChunk],
        history_messages: Optional[List[Dict[str, str]]] = None,
        explain_style: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        """Xây dựng danh sách messages chuẩn bị gửi cho LLM"""
        system_instruction = self.SYSTEM_PROMPT
        if explain_style:
            style_guides = {
                "easy": "Hãy giải thích thật dễ hiểu, dùng ngôn từ đơn giản và ví dụ đời sống sinh động.",
                "deep": "Hãy giải thích chuyên sâu, phân tích chi tiết cơ chế hoạt động, độ phức tạp thuật toán và góc nhìn kỹ thuật phần mềm.",
                "concise": "Hãy trả lời thật súc tích, ngắn gọn, đi thẳng vào trọng tâm.",
                "example": "Hãy tập trung đưa ra các ví dụ cụ thể và đoạn mã nguồn (code snippet) minh họa rõ ràng."
            }
            if explain_style in style_guides:
                system_instruction += f"\n\nPhong cách giải thích yêu cầu: {style_guides[explain_style]}"

        # Định dạng context từ các chunk
        context_parts = []
        for i, c in enumerate(retrieved_chunks, 1):
            page_info = f" (Trang {c.locator.get('page')})" if c.locator.get("page") else ""
            heading_info = f" - Mục: {c.heading}" if c.heading else ""
            context_parts.append(
                f"[{i}] Tài liệu tham khảo{heading_info}{page_info}:\n{c.content}"
            )

        context_text = "\n\n".join(context_parts) if context_parts else "Không tìm thấy đoạn tài liệu nào khớp chính xác."

        user_content = (
            f"--- TÀI LIỆU HỌC TẬP THAM KHẢO ---\n"
            f"{context_text}\n"
            f"----------------------------------\n\n"
            f"Câu hỏi của sinh viên: {query_text}"
        )

        messages = [{"role": "system", "content": system_instruction}]
        if history_messages:
            messages.extend(history_messages)
        messages.append({"role": "user", "content": user_content})

        return messages

    def match_citations(
        self,
        answer_text: str,
        retrieved_chunks: List[RetrievedChunk]
    ) -> List[Tuple[int, RetrievedChunk, str]]:
        """
        Bóc tách các nhãn [1], [2] từ câu trả lời và ánh xạ ngược lại với danh sách chunk đã truy xuất.
        Trả về danh sách (ordinal, chunk, quote).
        """
        # Tìm tất cả các số trong ngoặc vuông, vd: [1], [2]
        matches = set(re.findall(r'\[(\d+)\]', answer_text))
        citations = []
        ordinal = 1

        for num_str in sorted(matches, key=int):
            idx = int(num_str) - 1
            if 0 <= idx < len(retrieved_chunks):
                chunk = retrieved_chunks[idx]
                citations.append((ordinal, chunk, f"[{num_str}] {chunk.heading or ''}"))
                ordinal += 1

        # Nếu mô hình không ghi số ngoặc vuông cụ thể nhưng có chunks liên quan cao, gắn chunk top 1 làm citation mặc định
        if not citations and retrieved_chunks:
            citations.append((1, retrieved_chunks[0], retrieved_chunks[0].heading or "Tài liệu học tập"))

        return citations


rag_service = RAGService()
