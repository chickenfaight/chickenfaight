"""Populate free OpenRouter models: python -m app.db.seed_models."""

import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import InferenceAdapter, Model, Provider
from app.schemas.model_metadata import ModelProviderMetadata


OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
Price = Annotated[Decimal, Field(allow_inf_nan=False)]
TokenLimit = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
PRICING = TypeAdapter(dict[str, Price])


def is_free_pricing(pricing: object) -> bool:
    try:
        prices = PRICING.validate_python(pricing)
    except ValidationError:
        # Unknown, invalid, or tiered pricing isn't guaranteed to be free.
        return False
    return (
        prices.get("prompt") == 0
        and prices.get("completion") == 0
        and all(price == 0 for price in prices.values())
    )


class TopProvider(BaseModel):
    model_config = ConfigDict(extra="allow")

    max_completion_tokens: TokenLimit | None = None


class OpenRouterModel(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    pricing: dict[str, Price] = Field(default_factory=dict)
    context_length: TokenLimit | None = None
    top_provider: TopProvider | None = None

    @property
    def is_free(self) -> bool:
        # A :free suffix alone isn't evidence of current pricing. Unknown prices
        # and dynamic-price sentinels (negative values) are never treated as free.
        return is_free_pricing(self.pricing)


class ModelCatalogue(BaseModel):
    data: list[dict[str, Any]]


def parse_free_models(payload: object) -> list[OpenRouterModel]:
    catalogue = ModelCatalogue.model_validate(payload)
    return [
        OpenRouterModel.model_validate(model)
        for model in catalogue.data
        if model.get("id") != "openrouter/free" and is_free_pricing(model.get("pricing"))
    ]


async def fetch_free_models() -> list[OpenRouterModel]:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(f"{OPENROUTER_BASE_URL}/models")
        response.raise_for_status()
        return parse_free_models(response.json())


async def import_models(session: AsyncSession, models: list[OpenRouterModel]) -> int:
    """Upsert free models in one transaction using a fresh session."""
    now = datetime.now(UTC)
    # Deduplicate before writing and validate metadata outside the transaction.
    rows = []
    for model in {
        model.id: model for model in models
        if model.id != "openrouter/free" and model.is_free
    }.values():
        metadata = ModelProviderMetadata.model_validate(model.model_dump(
            mode="json", exclude={"id", "name", "pricing", "context_length"},
        ))
        cached_price = model.pricing.get("input_cache_read")
        rows.append({
            "api_model_id": model.id,
            "display_name": model.name,
            "input_cost": model.pricing["prompt"] * Decimal(1_000_000),
            "output_cost": model.pricing["completion"] * Decimal(1_000_000),
            "cached_input_cost": cached_price * Decimal(1_000_000) if cached_price is not None else None,
            "pricing_updated_at": now,
            "context_window": model.context_length,
            "max_output_tokens": model.top_provider.max_completion_tokens if model.top_provider else None,
            "provider_metadata": metadata.model_dump(mode="json"),
            "updated_at": now,
        })

    async with session.begin():
        provider_insert = insert(Provider).values(
            slug="openrouter",
            display_name="OpenRouter",
            base_url=OPENROUTER_BASE_URL,
            adapter=InferenceAdapter.OPENAI_COMPATIBLE,
        )
        provider_id = await session.scalar(provider_insert.on_conflict_do_update(
            index_elements=[Provider.slug],
            set_={
                "display_name": provider_insert.excluded.display_name,
                "base_url": provider_insert.excluded.base_url,
                "adapter": provider_insert.excluded.adapter,
                "updated_at": now,
            },
        ).returning(Provider.id))

        for row in rows:
            model_insert = insert(Model).values(provider_id=provider_id, **row)
            await session.execute(model_insert.on_conflict_do_update(
                index_elements=[Model.provider_id, Model.api_model_id],
                set_={key: getattr(model_insert.excluded, key) for key in row},
            ))
    return len(rows)


async def main() -> None:
    from app.db.session import SessionFactory, engine

    try:
        models = await fetch_free_models()
        async with SessionFactory() as session:
            count = await import_models(session, models)
        print(f"Imported or updated {count} free model(s) under the OpenRouter provider.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
