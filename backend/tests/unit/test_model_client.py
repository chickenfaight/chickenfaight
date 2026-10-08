from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.config import settings
from app.inference.model_client import OpenAIModelClient


class FakeStream:
    """Stands in for the SDK's async chunk stream."""

    def __init__(self, *deltas):
        self.chunks = [SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=delta))]) for delta in deltas]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for chunk in self.chunks:
            yield chunk


@pytest.mark.parametrize(("base_url", "extra_body"), [
    ("https://openrouter.ai/api/v1", {"reasoning": {"enabled": False, "exclude": True}}),
    # Other OpenAI-compatible providers may reject OpenRouter's options, so none are sent.
    ("https://genai.rcac.purdue.edu/api", None),
])
async def test_stream_yields_content_with_provider_options(base_url, extra_body):
    # `respx` can't intercept this SDK's HTTP client, so fake the SDK call itself.
    with patch("app.inference.model_client.settings", replace(settings, inference_base_url=base_url)):
        client = OpenAIModelClient(model="test-model")
        create = AsyncMock(return_value=FakeStream("Opening ", None, "argument."))
        client.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        deltas = [delta async for delta in client.stream([{"role": "system", "content": "rules"}], max_tokens=400)]

    assert deltas == ["Opening ", "argument."]
    kwargs = create.await_args.kwargs
    assert kwargs["model"] == "test-model"
    assert kwargs["stream"] is True
    assert kwargs["max_completion_tokens"] == 400
    assert kwargs["extra_body"] == extra_body
