import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    async with AsyncSessionLocal() as s:
        res = await s.execute(text("""
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_schema = 'app';
        """))
        for row in res.fetchall():
            print("Routine:", row[0])

if __name__ == "__main__":
    asyncio.run(main())
