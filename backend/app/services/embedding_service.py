import logging
from typing import List
from uuid import UUID
from fastembed import TextEmbedding

from app.core.config import settings

logger = logging.getLogger("lumi.embedding")

# Model ID mặc định tương ứng với bản ghi trong app.embedding_models
DEFAULT_MODEL_ID = UUID("00000000-0000-0000-0000-000000000384")
DEFAULT_MODEL_NAME = "BAAI/bge-small-en-v1.5"
DEFAULT_DIMENSIONS = 384

class EmbeddingService:
    _instance = None
    _model = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(EmbeddingService, cls).__new__(cls)
            try:
                logger.info(f"Khởi tạo FastEmbed với mô hình {DEFAULT_MODEL_NAME}...")
                cls._model = TextEmbedding(model_name=DEFAULT_MODEL_NAME)
                logger.info("FastEmbed đã sẵn sàng!")
            except Exception as e:
                logger.error(f"Lỗi khởi tạo FastEmbed: {e}")
                raise
        return cls._instance

    @property
    def model_id(self) -> UUID:
        return DEFAULT_MODEL_ID

    @property
    def dimensions(self) -> int:
        return DEFAULT_DIMENSIONS

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        Sinh vector embedding cho danh sách các đoạn văn bản (chunks).
        Trả về danh sách các vector float chuẩn hóa L2 có đúng 384 chiều.
        """
        if not texts:
            return []
        embeddings = list(self._model.embed(texts))
        return [e.tolist() for e in embeddings]

    def embed_query(self, query: str) -> List[float]:
        """
        Sinh vector embedding cho 1 câu hỏi tìm kiếm RAG.
        """
        embeddings = list(self._model.embed([query]))
        return embeddings[0].tolist()


# Singleton instance
embedding_service = EmbeddingService()
