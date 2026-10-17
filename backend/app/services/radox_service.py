import json
import logging
from typing import List, Dict, Any, AsyncGenerator, Optional
import httpx

from app.core.config import settings

logger = logging.getLogger("lumi.radox_service")


class RadoxChatService:
    """
    Dịch vụ giao tiếp với AI Gateway Radox AI:
    - Base URL: https://radoxai.com/v1
    - Hỗ trợ completion đồng bộ và bất đồng bộ Server-Sent Events (SSE) streaming.
    - Mặc định: gemini-3.6-flash (hoặc claude-sonnet-5).
    """

    def __init__(self):
        self.api_key = settings.RADOX_API_KEY
        self.base_url = settings.RADOX_BASE_URL.rstrip("/")
        self.default_model = settings.RADOX_DEFAULT_MODEL

    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def generate_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> str:
        """Gọi Radox AI hoàn tất phản hồi dạng non-streaming"""
        selected_model = model or self.default_model
        payload = {
            "model": selected_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers=self._get_headers(),
                json=payload,
            )
            if resp.status_code != 200:
                logger.error(f"Radox AI error HTTP {resp.status_code}: {resp.text}")
                raise RuntimeError(f"RADOX_API_ERROR: {resp.status_code} - {resp.text}")

            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def stream_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> AsyncGenerator[str, None]:
        """Gọi Radox AI hoàn tất phản hồi dạng streaming chunk-by-chunk qua SSE"""
        selected_model = model or self.default_model
        payload = {
            "model": selected_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=self._get_headers(),
                json=payload,
            ) as response:
                if response.status_code != 200:
                    err_body = await response.aread()
                    logger.error(f"Radox AI streaming error HTTP {response.status_code}: {err_body.decode()}")
                    raise RuntimeError(f"RADOX_STREAM_ERROR: {response.status_code} - {err_body.decode()}")

                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith("data:"):
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk_json = json.loads(data_str)
                            delta = chunk_json.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield content
                        except json.JSONDecodeError:
                            continue


radox_service = RadoxChatService()
