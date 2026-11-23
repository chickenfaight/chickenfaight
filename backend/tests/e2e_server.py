"""Loopback-only test app. Replaces production lifespan; NEVER migrates POSTGRES_URL.

Used by Playwright and the Go/Python contract test. External inference is scripted;
HTTP, cookies, sockets, matchmaking, engine, and persistence are real.
"""
import asyncio
import tempfile
from contextlib import asynccontextmanager
from uuid import UUID

import uvicorn
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.db.migrate import migrate, reset
from database_safety import require_test_database

if not settings.test_database_url:
    raise RuntimeError("TEST_POSTGRES_URL is required for browser tests")
TEST_URL = require_test_database(settings.test_database_url, settings.database_url)
if settings.app_env != "test":
    raise RuntimeError("Browser harness requires APP_ENV=test")

from app import main
from app.auth import bilc as bilc_auth, dependencies
from app.db import session as db
from app.db.seed_ladders import provision_ladders
from app.engine import game_engine
from app.models import InferenceAdapter, Model, Provider, Topic
from app.services import bilc_connections
from app.services.bilc_releases import BilcReleases
from app.services.matchmaking import Matchmaker
from verdict_fixture import scored_verdict

MODEL_ID = UUID("11111111-1111-4111-8111-111111111111")
FAILED_MODEL_ID = UUID("22222222-2222-4222-8222-222222222222")
ARGUMENT = '<img src=x onerror="window.modelExecuted=true"> Literal argument.'


class ScriptedModel:
    def __init__(self, model):
        self.model = model
        self.client = self

    async def close(self):
        pass

    async def stream(self, messages, max_tokens):
        if self.model == "failed-test-model":
            raise ValueError("scripted unavailable model")
        yield ARGUMENT[:20]
        await asyncio.sleep(0.1)
        yield ARGUMENT[20:]

    async def judge(self, topic, pro, con):
        await asyncio.sleep(0.1)
        return scored_verdict("pro", "The pro argument made the stronger case.")


@asynccontextmanager
async def test_lifespan(app):
    await asyncio.to_thread(reset, TEST_URL)
    await asyncio.to_thread(migrate, TEST_URL, allow_reset=False)
    from app.services import result_outbox
    journal = tempfile.TemporaryDirectory(prefix="chickenfaight-browser-results-")
    result_outbox.pending_results = result_outbox.ResultOutbox(journal.name)
    engine = create_async_engine(TEST_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    for module in (db, dependencies, bilc_auth, bilc_connections, game_engine):
        module.SessionFactory = factory
    game_engine.OpenAIModelClient = ScriptedModel
    game_engine.GameEngine.RETRY_DELAY = 0
    async with factory() as session:
        provider = Provider(slug="test", display_name="Test", base_url="https://example.invalid", adapter=InferenceAdapter.OPENAI_COMPATIBLE)
        session.add(provider)
        await session.flush()
        session.add_all([
            Model(id=MODEL_ID, provider_id=provider.id, api_model_id="test-model", display_name="Test model"),
            Model(id=FAILED_MODEL_ID, provider_id=provider.id, api_model_id="failed-test-model", display_name="Failing model"),
            Topic(topic="Should transit be free?", category="Cities", pro_position="Transit should be free.", con_position="Transit should not be free."),
        ])
        await session.commit()
        await provision_ladders(session)
    # Many independent users share one loopback IP; rate limiting has its own integration suite.
    from app.api.rate_limit import _limiters
    for limiter in _limiters:
        limiter.burst = 1000
    app.state.bilc_connections = bilc_connections.BilcConnections()

    async def no_release():
        return None

    app.state.bilc_releases = BilcReleases(fetch=no_release)
    app.state.matchmaker = Matchmaker(bilc=app.state.bilc_connections)
    task = asyncio.create_task(app.state.matchmaker.run())
    try:
        yield
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await app.state.matchmaker.close()
        await engine.dispose()
        journal.cleanup()


main.app.router.lifespan_context = test_lifespan
if __name__ == "__main__":
    uvicorn.run(main.app, host="127.0.0.1", port=8765, log_level="warning")
