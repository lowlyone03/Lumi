import asyncio
from app.core.database import AsyncSessionLocal
from sqlalchemy import text

async def main():
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(text("SELECT id, title, kind, status FROM app.sources ORDER BY created_at DESC LIMIT 10"))).all()
        for r in rows:
            print(f"ID: {r[0]} | Title: {ascii(r[1])} | Kind: {r[2]} | Status: {r[3]}")

if __name__ == "__main__":
    asyncio.run(main())
