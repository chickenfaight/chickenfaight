"""Development-only table bootstrap.

Run with: uv run python -m app.db.create_tables

Temporary solution to creating new tables before migration scripts.
THIS DOES NOT UPDATE EXISTING TABLES!
If updating existing tables: drop all tables and run or manually alter them
"""

import asyncio

from app.db.base import Base
from app.db.session import engine
from app.models import *  # noqa: F401 - registers models with Base


async def create_tables() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(create_tables())
