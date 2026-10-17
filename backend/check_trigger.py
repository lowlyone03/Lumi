import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    async with AsyncSessionLocal() as s:
        res = await s.execute(text("""
            SELECT table_name, privilege_type 
            FROM information_schema.role_table_grants 
            WHERE grantee = 'app_api' AND table_schema = 'app'
            ORDER BY table_name;
        """))
        for row in res.fetchall():
            print(row[0], "-->", row[1])

if __name__ == "__main__":
    asyncio.run(main())
