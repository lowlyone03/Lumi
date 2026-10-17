import io
import re
import unicodedata
import logging
from dataclasses import dataclass
from typing import List, Optional, Dict, Any

import fitz  # PyMuPDF

logger = logging.getLogger("lumi.pdf_parser")


def clean_vietnamese_pdf_text(text: str) -> str:
    """Chuẩn hóa bảng mã Unicode NFC và sửa lỗi tách dấu/khoảng trắng thừa khi bóc tách PDF tiếng Việt"""
    if not text:
        return ""
    # Xóa khoảng trắng đứng ngay trước dấu thanh kết hợp (combining diacritical marks)
    text = re.sub(r"\s+([\u0300-\u036f])", r"\1", text)
    text = unicodedata.normalize("NFC", text)
    # Gộp các nguyên âm có dấu bị tách rời phụ âm cuối trong cùng một âm tiết tiếng Việt phổ biến
    text = re.sub(
        r"([àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ])\s+(c|ch|m|n|ng|nh|p|t|i|u|y)\b",
        r"\1\2",
        text,
    )
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class ParsedChunk:
    chunk_index: int
    content: str
    heading: Optional[str]
    token_count: int
    locator: Dict[str, Any]
    page_number: int


@dataclass
class ParsedWarning:
    warning_kind: str
    page_number: int
    details: Dict[str, Any]


@dataclass
class PDFParseResult:
    page_count: int
    chunks: List[ParsedChunk]
    warnings: List[ParsedWarning]


class PDFParser:
    """
    Bộ bóc tách tài liệu PDF chuyên dụng cho Lumi:
    - Nhận biết khối đoạn văn (Paragraph-Aware Extraction qua PyMuPDF).
    - Chuẩn hóa locator tuân thủ 100% ràng buộc CSDL: {"type": "pdf_page", "page": N, "page_end": N}.
    - Phát hiện trang trắng/trang quét ảnh không có OCR để sinh cảnh báo (source_warnings).
    """

    def __init__(self, target_chunk_size: int = 500, chunk_overlap: int = 80):
        self.target_chunk_size = target_chunk_size  # Ước lượng tokens
        self.chunk_overlap = chunk_overlap

    def _approx_tokens(self, text: str) -> int:
        """Ước lượng số lượng token nhanh và chính xác cho tiếng Việt và tiếng Anh"""
        words = len(text.split())
        return max(1, int(words * 1.3))

    def parse_pdf(self, pdf_bytes: bytes) -> PDFParseResult:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = len(doc)
        chunks: List[ParsedChunk] = []
        warnings: List[ParsedWarning] = []

        chunk_idx = 0
        current_heading: Optional[str] = None

        for page_idx in range(page_count):
            page_num = page_idx + 1
            page = doc[page_idx]

            # Lấy các khối văn bản: (x0, y0, x1, y1, text, block_no, block_type)
            blocks = page.get_text("blocks")
            text_blocks = [b for b in blocks if b[6] == 0 and b[4].strip()]

            # Phát hiện trang không có văn bản (ảnh quét chưa OCR)
            if not text_blocks:
                warnings.append(ParsedWarning(
                    warning_kind="page_no_text",
                    page_number=page_num,
                    details={"message": f"Trang {page_num} không tìm thấy văn bản (có thể là ảnh quét hoặc biểu đồ)"}
                ))
                continue

            page_paragraphs: List[str] = []

            for block in text_blocks:
                block_text = clean_vietnamese_pdf_text(block[4])
                if not block_text:
                    continue

                # Nhận diện tiêu đề: ngắn, viết hoa hoặc bắt đầu bằng số thứ tự (1., 1.1, Chương...)
                is_heading = (
                    len(block_text) < 120 and (
                        re.match(r"^(Chương|Bài|Mục|Phần|\d+(\.\d+)*)\s+", block_text, re.IGNORECASE) or
                        block_text.isupper()
                    )
                )
                if is_heading:
                    current_heading = block_text

                page_paragraphs.append(block_text)

            # Gom các đoạn văn thành chunks có kích thước hợp lý
            accumulated_text = ""
            for para in page_paragraphs:
                if accumulated_text and self._approx_tokens(accumulated_text + " " + para) > self.target_chunk_size:
                    # Tạo chunk từ accumulated_text
                    tokens = self._approx_tokens(accumulated_text)
                    chunks.append(ParsedChunk(
                        chunk_index=chunk_idx,
                        content=accumulated_text,
                        heading=current_heading,
                        token_count=tokens,
                        locator={"type": "pdf_page", "page": page_num, "page_end": page_num},
                        page_number=page_num
                    ))
                    chunk_idx += 1
                    # Giữ lại một phần đoạn trước làm overlap nếu có
                    words = accumulated_text.split()
                    overlap_words = words[-self.chunk_overlap:] if len(words) > self.chunk_overlap else []
                    accumulated_text = " ".join(overlap_words) + (" " + para if overlap_words else para)
                else:
                    accumulated_text = (accumulated_text + "\n\n" + para).strip() if accumulated_text else para

            # Chunk cuối cùng của trang nếu còn
            if accumulated_text:
                tokens = self._approx_tokens(accumulated_text)
                chunks.append(ParsedChunk(
                    chunk_index=chunk_idx,
                    content=accumulated_text,
                    heading=current_heading,
                    token_count=tokens,
                    locator={"type": "pdf_page", "page": page_num, "page_end": page_num},
                    page_number=page_num
                ))
                chunk_idx += 1

        doc.close()
        return PDFParseResult(
            page_count=page_count,
            chunks=chunks,
            warnings=warnings
        )


pdf_parser = PDFParser()
