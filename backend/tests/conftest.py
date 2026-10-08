import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.api.rate_limit import reset_rate_limits
from app.auth.dependencies import get_current_user
from app.config import settings
from app.db.migrate import migrate, reset
from app.db.session import get_session
from app.main import app
from app.models import InferenceAdapter, Model, Provider, User
from app.services.matchmaking import Matchmaker


@pytest.fixture(autouse=True)
def fresh_rate_limits() -> None:
    reset_rate_limits()


@pytest.fixture(scope="session")
def test_database_url() -> str:
    if settings.test_database_url is None:
        pytest.skip("TEST_POSTGRES_URL is not set")
    return settings.test_database_url


@pytest.fixture(scope="session")
async def db_engine(test_database_url: str) -> AsyncIterator[AsyncEngine]:
    # Build the schema from the migrations (not create_all) so every run tests them.
    await asyncio.to_thread(reset, test_database_url)
    await asyncio.to_thread(migrate, test_database_url, allow_reset=False)
    engine = create_async_engine(test_database_url)
    yield engine
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """A session inside an outer transaction that is rolled back after the test."""
    async with db_engine.connect() as connection:
        transaction = await connection.begin()
        session = AsyncSession(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()


MakeUser = Callable[..., Awaitable[User]]


@pytest.fixture
def make_user(db_session: AsyncSession) -> MakeUser:
    async def make(username: str | None = None) -> User:
        user = User(google_sub=f"test-{uuid4()}", username=username)
        db_session.add(user)
        # Commit (releases a savepoint) so a service's rollback can't undo seeded rows.
        await db_session.commit()
        return user

    return make


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """Unauthenticated client for the real app, backed by the test session."""

    async def test_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_session] = test_session
    app.state.matchmaker = Matchmaker()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        yield http
    app.dependency_overrides.clear()


@pytest.fixture
def make_model(db_session: AsyncSession) -> Callable[..., Awaitable[Model]]:
    async def make(is_active: bool = True) -> Model:
        provider = Provider(
            slug=f'test-{uuid4()}',
            display_name='Test provider',
            base_url='https://example.invalid/v1',
            adapter=InferenceAdapter.OPENAI_COMPATIBLE,
        )
        db_session.add(provider)
        await db_session.flush()
        model = Model(
            provider_id=provider.id,
            api_model_id=f'test-{uuid4()}',
            display_name='Test model',
            is_active=is_active,
        )
        db_session.add(model)
        await db_session.commit()
        return model

    return make


@pytest.fixture
def log_in(client: AsyncClient) -> Callable[[User], None]:
    """Make `client` act as the given user (cookie auth is covered in test_auth_session)."""

    def log_in_as(user: User) -> None:
        app.dependency_overrides[get_current_user] = lambda: user

    return log_in_as
