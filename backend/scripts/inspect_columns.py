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
        sql = """
            SELECT table_name, column_name, udt_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'app'
              AND table_name IN ('profiles', 'user_access', 'user_preferences', 'storage_usage', 'quota_periods')
            ORDER BY table_name, ordinal_position;
        """
        res = await session.execute(text(sql))
        for row in res.fetchall():
            print(f"{row[0]}.{row[1]}: {row[2]} ({row[3]})")

if __name__ == "__main__":
    asyncio.run(main())
