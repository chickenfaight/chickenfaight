"""Temporary topic importer: python -m app.db.seed topics.example.txt [--inactive]."""

import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.topics import ParsedTopic, add_topics, parse_topics


def read_topics(path: Path) -> list[ParsedTopic]:
    return parse_topics(path.read_text(encoding="utf-8"), source=str(path))


async def import_topics(
    session: AsyncSession, path: Path, *, is_active: bool = True
) -> int:
    """Import in one transaction using a fresh session; skip identical entries."""
    topics = await asyncio.to_thread(read_topics, path)
    async with session.begin():
        return await add_topics(session, topics, is_active=is_active)


async def main(path: Path, *, is_active: bool) -> None:
    from app.db.session import SessionFactory, engine

    try:
        async with SessionFactory() as session:
            added = await import_topics(session, path, is_active=is_active)
        print(f"Added {added} topic(s). Existing entries were left unchanged.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--inactive", action="store_true", help="Keep newly added topics inactive")
    args = parser.parse_args()
    asyncio.run(main(args.path, is_active=not args.inactive))
