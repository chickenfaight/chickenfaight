from types import SimpleNamespace
from unittest.mock import AsyncMock

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


async def test_stream_disables_reasoning_and_yields_content():
    # `respx` can't intercept this SDK's HTTP client, so fake the SDK call itself.
    client = OpenAIModelClient(model="test-model")
    create = AsyncMock(return_value=FakeStream("Opening ", None, "argument."))
    client.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    deltas = [delta async for delta in client.stream([{"role": "system", "content": "rules"}], max_tokens=400)]

    assert deltas == ["Opening ", "argument."]
    kwargs = create.await_args.kwargs
    assert kwargs["model"] == "test-model"
    assert kwargs["stream"] is True
    assert kwargs["max_completion_tokens"] == 400
    assert kwargs["extra_body"] == {"reasoning": {"enabled": False}}
