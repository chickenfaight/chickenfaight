import httpx
import pytest
import respx
from pydantic import ValidationError

from app.db.seed_models import (
    OPENROUTER_BASE_URL,
    fetch_free_models,
    is_free_pricing,
    parse_free_models,
)


@pytest.mark.parametrize("pricing, expected", [
    ({"prompt": "0", "completion": "0"}, True),
    ({"prompt": "0.000", "completion": "0e-10", "input_cache_read": "0"}, True),
    ({"prompt": "0", "completion": "0.000001"}, False),
    ({"prompt": "0.000001", "completion": "0"}, False),
    ({"prompt": "0", "completion": "0", "request": "0.01"}, False),
    ({"prompt": "0", "completion": "0", "input_cache_read": "0.01"}, False),
    ({"prompt": "-1", "completion": "-1"}, False),
    ({"prompt": "0"}, False),
    ({}, False),
    (None, False),
    ({"prompt": "NaN", "completion": "0"}, False),
    ({"prompt": "0", "completion": "Infinity"}, False),
    ({"prompt": "0", "completion": None}, False),
    ({"prompt": "0", "completion": "0", "overrides": [{"prompt": "0.01"}]}, False),
])
def test_only_explicit_zero_pricing_is_free(pricing, expected):
    assert is_free_pricing(pricing) is expected


@respx.mock
async def test_fetch_filters_actual_prices_instead_of_model_suffix():
    route = respx.get(f"{OPENROUTER_BASE_URL}/models").mock(return_value=httpx.Response(
        200, json={"data": [
            {"id": "lab/free-model", "name": "Free", "pricing": {"prompt": "0", "completion": "0"}},
            {"id": "openrouter/free", "name": "Free Models Router", "pricing": {"prompt": "0", "completion": "0"}},
            {"id": "lab/paid:free", "name": "Paid", "pricing": {"prompt": "0", "completion": "0.01"}},
            {"id": "openrouter/auto", "name": "Auto", "pricing": {"prompt": "-1", "completion": "-1"}},
            {"id": "lab/tiered", "pricing": {"prompt": "1", "completion": "1", "overrides": []}},
            {"id": "lab/unknown:free", "name": "Unknown"},
        ]},
    ))
    models = await fetch_free_models()
    assert [model.id for model in models] == ["lab/free-model"]
    assert route.call_count == 1
    assert "authorization" not in route.calls[0].request.headers


@respx.mock
async def test_fetch_rejects_http_errors():
    respx.get(f"{OPENROUTER_BASE_URL}/models").mock(return_value=httpx.Response(503))
    with pytest.raises(httpx.HTTPStatusError):
        await fetch_free_models()


@pytest.mark.parametrize("payload", [
    {},
    {"data": None},
    {"data": [{"id": "lab/free", "pricing": {"prompt": "0", "completion": "0"}}]},
    {"data": [{"id": "lab/free", "name": "Free", "context_length": 0,
               "pricing": {"prompt": "0", "completion": "0"}}]},
])
def test_invalid_selected_models_or_catalogue_fail_before_import(payload):
    with pytest.raises(ValidationError):
        parse_free_models(payload)
