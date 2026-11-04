from decimal import Decimal

from sqlalchemy import select

from app.db.seed_models import OpenRouterModel, delist_missing_models, import_models, parse_free_models
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


async def saved_models(session) -> dict[str, Model]:
    # Core statements bypass the ORM identity map; reload it before inspecting.
    session.expire_all()
    async with session.begin():
        return {model.api_model_id: model for model in await session.scalars(select(Model))}


async def test_models_leaving_the_free_catalogue_are_deactivated(db_session):
    staying, leaving = catalogue()
    await import_models(db_session, [staying, leaving])
    assert await delist_missing_models(db_session, [staying]) == [leaving.name]
    saved = await saved_models(db_session)
    assert saved[staying.id].is_active and saved[staying.id].delisted_at is None
    assert not saved[leaving.id].is_active and saved[leaving.id].delisted_at is not None
    # Nothing more to do the second time.
    assert await delist_missing_models(db_session, [staying]) == []


async def test_a_paid_model_counts_as_gone(db_session):
    staying, leaving = catalogue()
    await import_models(db_session, [staying, leaving])
    now_paid = OpenRouterModel(id=leaving.id, name=leaving.name, pricing={"prompt": "1", "completion": "1"})
    assert await delist_missing_models(db_session, [staying, now_paid]) == [leaving.name]


async def test_a_delisted_model_returns_when_free_again_and_keeps_its_id(db_session):
    staying, leaving = catalogue()
    await import_models(db_session, [staying, leaving])
    original_id = (await saved_models(db_session))[leaving.id].id
    await delist_missing_models(db_session, [staying])
    await import_models(db_session, [staying, leaving])
    assert await delist_missing_models(db_session, [staying, leaving]) == []
    saved = (await saved_models(db_session))[leaving.id]
    assert saved.is_active and saved.delisted_at is None and saved.id == original_id


async def test_a_model_deactivated_by_hand_stays_off(db_session):
    manual, leaving = catalogue()
    await import_models(db_session, [manual, leaving])
    async with db_session.begin():
        (await db_session.scalars(select(Model).where(Model.api_model_id == manual.id))).one().is_active = False
    # Still off when it's in the catalogue, and when it leaves and returns.
    await import_models(db_session, [manual, leaving])
    assert not (await saved_models(db_session))[manual.id].is_active
    assert await delist_missing_models(db_session, [leaving]) == []
    await import_models(db_session, [manual, leaving])
    assert not (await saved_models(db_session))[manual.id].is_active


async def test_an_empty_catalogue_deactivates_nothing(db_session):
    models = catalogue()
    await import_models(db_session, models)
    assert await delist_missing_models(db_session, []) == []
    assert all(model.is_active for model in (await saved_models(db_session)).values())


async def test_other_providers_are_untouched(db_session, make_model):
    other = await make_model()
    other_api_id = other.api_model_id
    staying, leaving = catalogue()
    await import_models(db_session, [staying, leaving])
    assert await delist_missing_models(db_session, [staying]) == [leaving.name]
    assert (await saved_models(db_session))[other_api_id].is_active


async def test_delisted_models_leave_the_arena_list_and_the_queue(client, log_in, make_user, db_session):
    staying, leaving = catalogue()
    await import_models(db_session, [staying, leaving])
    gone_id = (await saved_models(db_session))[leaving.id].id
    await delist_missing_models(db_session, [staying])
    log_in(await make_user("player"))
    arenas = (await client.get("/v1/arenas")).json()
    assert str(gone_id) not in [arena["id"] for arena in arenas]
    assert leaving.name not in [arena["display_name"] for arena in arenas]
    response = await client.post("/v1/match/queue", json={"model_id": str(gone_id)})
    assert response.status_code == 404


async def test_a_model_that_starts_requiring_reasoning_is_delisted_and_can_return(db_session):
    def entry(reasoning):
        return {"id": "lab/thinker:free", "name": "Thinker", "pricing": {"prompt": "0", "completion": "0"}, "reasoning": reasoning}

    other = {"id": "lab/other:free", "name": "Other", "pricing": {"prompt": "0", "completion": "0"}}
    fine = parse_free_models({"data": [entry({"mandatory": False}), other]})
    await import_models(db_session, fine)
    now_mandatory = parse_free_models({"data": [entry({"mandatory": True}), other]})
    await import_models(db_session, now_mandatory)
    assert await delist_missing_models(db_session, now_mandatory) == ["Thinker"]
    assert not (await saved_models(db_session))["lab/thinker:free"].is_active
    await import_models(db_session, fine)
    assert (await saved_models(db_session))["lab/thinker:free"].is_active

