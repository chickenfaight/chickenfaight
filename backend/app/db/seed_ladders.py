"""Provision a ladder for each active model and the one BYOM ladder. `seed_models` runs this too."""
import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Ladder, Model


def cloud_ladder_slug(model_id: object) -> str:
    return f"ladder-{model_id}"


async def provision_ladders(session: AsyncSession) -> int:
    """Add any missing ladders in one transaction using a fresh session; returns how many."""
    added = 0
    async with session.begin():
        # BACKEND.md: exactly one `byom` row.
        if await session.scalar(select(Ladder.id).where(Ladder.kind == "byom")) is None:
            session.add(Ladder(
                slug="byom-arena",
                display_name="BYOM Arena",
                kind="byom",
                is_active=True,
                provider_metadata={"provider": "byom", "context_length": 4096},
            ))
            added += 1

        models = (await session.scalars(select(Model).where(Model.is_active.is_(True)))).all()
        existing = set(await session.scalars(select(Ladder.slug)))
        for model in models:
            # By slug, since that's how the queue finds a model's ladder.
            slug = cloud_ladder_slug(model.id)
            if slug not in existing:
                session.add(Ladder(
                    slug=slug,
                    display_name=f"Ladder: {model.display_name}",
                    kind="cloud",
                    provider_model_id=model.api_model_id,
                    is_active=True,
                    provider_metadata={"provider": "cloud", "context_length": model.context_window or 8192},
                ))
                added += 1
    return added


async def main() -> None:
    from app.db.session import SessionFactory, engine

    try:
        async with SessionFactory() as session:
            added = await provision_ladders(session)
        print(f"Added {added} ladder(s). Existing ladders were left unchanged.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
