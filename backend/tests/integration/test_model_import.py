from decimal import Decimal

from sqlalchemy import select

from app.db.seed_models import OpenRouterModel, import_models, parse_free_models
from app.models import InferenceAdapter, Model, Provider


def catalogue():
    return parse_free_models({"data": [
        {
            "id": "nvidia/example:free", "name": "NVIDIA: Example (free)",
            "pricing": {"prompt": "0", "completion": "0", "input_cache_read": "0"},
            "context_length": 128_000,
            "top_provider": {"max_completion_tokens": 8_192, "is_moderated": False},
            "architecture": {"output_modalities": ["text"]},
            "supported_parameters": ["response_format"],
        },
        {"id": "google/example", "name": "Google: Example",
         "pricing": {"prompt": "0", "completion": "0"}},
    ]})


async def test_import_uses_one_provider_and_preserves_ids_on_refresh(db_session):
    models = catalogue()
    assert await import_models(db_session, models + models) == 2
    async with db_session.begin():
        provider = (await db_session.scalars(select(Provider))).one()
        assert provider.slug == "openrouter"
        assert provider.display_name == "OpenRouter"
        assert provider.base_url == "https://openrouter.ai/api/v1"
        assert provider.adapter == InferenceAdapter.OPENAI_COMPATIBLE
        saved = {model.api_model_id: model for model in await db_session.scalars(select(Model))}
        original_ids = {api_id: model.id for api_id, model in saved.items()}
        assert len(saved) == 2
        assert {model.provider_id for model in saved.values()} == {provider.id}
        first = saved[models[0].id]
        assert first.input_cost == first.output_cost == first.cached_input_cost == Decimal("0")
        assert first.context_window == 128_000
        assert first.max_output_tokens == 8_192
        assert first.pricing_updated_at is not None
        assert first.is_active
        assert first.provider_metadata["supported_parameters"] == ["response_format"]
        assert saved[models[1].id].cached_input_cost is None
        assert saved[models[1].id].max_output_tokens is None
        first.is_active = False
        provider.is_active = False

    models[0].name = "Updated name"
    models[0].context_length = 256_000
    assert await import_models(db_session, models) == 2
    # Core upserts bypass the ORM identity map; reload it before inspecting.
    db_session.expire_all()
    async with db_session.begin():
        provider = (await db_session.scalars(select(Provider))).one()
        saved = {model.api_model_id: model for model in await db_session.scalars(select(Model))}
        assert {api_id: model.id for api_id, model in saved.items()} == original_ids
        assert saved[models[0].id].display_name == "Updated name"
        assert saved[models[0].id].context_window == 256_000
        assert not saved[models[0].id].is_active
        assert not provider.is_active


async def test_import_does_not_insert_paid_models_or_delete_unrelated_rows(db_session, make_model):
    other = await make_model()
    other_id = other.id
    free = catalogue()
    paid = OpenRouterModel(id="lab/paid:free", name="Paid", pricing={"prompt": "0", "completion": "1"})
    assert await import_models(db_session, free + [paid]) == 2
    assert await import_models(db_session, []) == 0
    async with db_session.begin():
        providers = list(await db_session.scalars(select(Provider)))
        assert len([provider for provider in providers if provider.slug == "openrouter"]) == 1
        assert len(providers) == 2
        saved = list(await db_session.scalars(select(Model)))
        assert len(saved) == 3
        assert any(model.id == other_id for model in saved)
        assert all(model.api_model_id != paid.id for model in saved)
