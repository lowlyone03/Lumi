import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    async with AsyncSessionLocal() as s:
        res = await s.execute(text("""
            SELECT conname, pg_get_constraintdef(oid) 
            FROM pg_constraint 
            WHERE conname LIKE '%note%';
        """))
        for row in res.fetchall():
            print(row[0], "-->", row[1])

if __name__ == "__main__":
    asyncio.run(main())
