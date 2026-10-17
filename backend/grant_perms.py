import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    async with AsyncSessionLocal() as s:
        print("Granting permissions on app.attempt_answers to app_api...")
        await s.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON app.attempt_answers TO app_api;"))
        await s.commit()
        print("GRANT SUCCESSFUL!")

if __name__ == "__main__":
    asyncio.run(main())
