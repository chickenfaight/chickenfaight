"""Temporary topic importer: python -m app.db.seed topics.example.txt [--inactive]."""

import argparse
import asyncio
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.topic import Topic
from app.repositories.topic import TopicRepository


def read_topics(path: Path) -> list[tuple[str, str, str, str]]:
    topics = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = [field.strip() for field in line.split("|")]
        if len(fields) != 4 or any(not field or len(field) > 255 for field in fields):
            raise ValueError(
                f"{path}:{line_number}: expected category | topic | pro position | con position; "
                "each field must contain 1–255 characters."
            )
        topics.append((fields[0], fields[1], fields[2], fields[3]))
    return topics


async def import_topics(
    session: AsyncSession, path: Path, *, is_active: bool = True
) -> int:
    """Import in one transaction using a fresh session; skip identical entries."""
    topics = await asyncio.to_thread(read_topics, path)
    repository = TopicRepository(session)
    added = 0
    async with session.begin():
        for category, topic, pro_position, con_position in dict.fromkeys(topics):
            if await repository.get_by_content(topic, pro_position, con_position, category):
                continue
            repository.add(Topic(
                category=category,
                topic=topic,
                pro_position=pro_position,
                con_position=con_position,
                is_active=is_active,
            ))
            added += 1
    return added


async def main(path: Path, *, is_active: bool) -> None:
    from app.db.session import SessionFactory, engine

    try:
        async with SessionFactory() as session:
            added = await import_topics(session, path, is_active=is_active)
        print(f"Added {added} topic(s). Existing entries were left unchanged.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--inactive", action="store_true", help="Keep newly added topics inactive")
    args = parser.parse_args()
    asyncio.run(main(args.path, is_active=not args.inactive))
