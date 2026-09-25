"""Creates missing tables. Run with: uv run python -m app.db.create_tables

THIS DOES NOT UPDATE EXISTING TABLES. See "Changing the schema" in backend/BACKEND.md.
"""

import asyncio
import sys

from app.db.base import Base
from app.db.session import engine
from app.models import *  # noqa: F401 - registers models with Base


async def create_tables() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    await engine.dispose()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(create_tables())
