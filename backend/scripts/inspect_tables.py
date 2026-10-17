import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    async with AsyncSessionLocal() as session:
        for tbl in ['embedding_models', 'sources', 'source_versions', 'source_chunks', 'chunk_embeddings', 'jobs']:
            print(f"\n--- TABLE: app.{tbl} ---")
            res = await session.execute(text(f"""
                SELECT column_name, udt_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'app' AND table_name = '{tbl}'
                ORDER BY ordinal_position;
            """))
            for r in res.fetchall():
                print(f"  {r[0]}: {r[1]} (nullable={r[2]})")

        print("\n--- DATA IN app.embedding_models ---")
        res2 = await session.execute(text("SELECT * FROM app.embedding_models;"))
        for r in res2.fetchall():
            print(" ", r)

if __name__ == "__main__":
    asyncio.run(main())
