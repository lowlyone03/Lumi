import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    async with AsyncSessionLocal() as s:
        samples = [
            '{"type": "pdf_page", "page": 1}',
            '{"type": "pdf_page", "page": 1, "page_end": 2}',
            '{"type": "pdf_page", "page": 1, "regions": []}',
            '{"type": "pdf_page", "page": 1, "page_end": 1, "regions": [{"page": 1, "bbox": [50, 100, 500, 300]}]}'
        ]
        for val in samples:
            r = await s.execute(text("SELECT app.is_valid_locator(CAST(:loc AS jsonb));"), {"loc": val})
            print(val, "->", r.scalar())

if __name__ == "__main__":
    asyncio.run(main())
