from sqlalchemy.ext.asyncio import AsyncSession
import asyncio
import sys
from app.models import Ladder, Model
from app.db.session import SessionFactory
from sqlalchemy import select

async def seed_ladders() -> None:
    """Seed the ladders table with an entry for each model and a BYOM arena."""
    async with SessionFactory() as session:
        # 1. Seed BYOM arena (Exactly one `byom` row)
        stmt_byom = select(Ladder).where(Ladder.kind == "byom")
        existing_byom = (await session.execute(stmt_byom)).scalar_one_or_none()
        
        if not existing_byom:
            session.add(Ladder(
                slug="byom-arena",
                display_name="BYOM Arena",
                kind="byom",
                is_active=True,
                provider_metadata={"provider": "byom", "context_length": 4096}
            ))

        # 2. Seed a ladder for each model
        # According to BACKEND.md: "One queue per ladder. Pair the two closest-rated players... BYOM players queue only with an online, idle device."
        # We create a ladder entry for every model in the database.
        stmt_models = select(Model).where(Model.is_active == True)
        models = (await session.execute(stmt_models)).scalars().all()
        
        for model in models:
            # Check if ladder for this model already exists
            stmt_ladder = select(Ladder).where(
                Ladder.provider_model_id == model.api_model_id,
                Ladder.kind == "cloud"
            )
            existing_ladder = (await session.execute(stmt_ladder)).scalar_one_or_none()
            
            if not existing_ladder:
                session.add(Ladder(
                    slug=f"ladder-{model.id}",
                    display_name=f"Ladder: {model.display_name}",
                    kind="cloud",
                    provider_model_id=model.api_model_id,
                    is_active=True,
                    provider_metadata={"provider": "cloud", "context_length": model.context_window or 8192}
                ))

        await session.commit()
        print("Seeded ladders (BYOM and model-specific) successfully.")

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(seed_ladders())
