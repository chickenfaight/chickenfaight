import asyncio
from contextlib import asynccontextmanager, suppress
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.api.auth import router as auth_router
from app.api.exception_handlers import register_exception_handlers
from app.api.matchmaking import router as matchmaking_router
from app.api.game import router as game_router
from app.api.users import router as users_router
from app.api.friends import router as friends_router
from app.config import settings
from app.services.auth_session import SESSION_LIFETIME
from app.db.migrate import migrate
from app.db.session import engine
from app.services.matchmaking import Matchmaker


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await asyncio.to_thread(
        migrate,
        settings.database_url,
        allow_reset=settings.app_env == "development",
    )

    matchmaker = Matchmaker()
    app.state.matchmaker = matchmaker

    task = asyncio.create_task(matchmaker.run())

    try:
        yield
    finally:
        task.cancel()
        try:
            with suppress(asyncio.CancelledError):
                await task
        finally:
            await engine.dispose()


app = FastAPI(lifespan=lifespan)

register_exception_handlers(app)

# This signed cookie temporarily carries OAuth state during the redirect and
# later carries our local `user_id`. It restores sessions for HTTP and WebSocket
# connections alike. Use HTTPS-only cookies in production.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    max_age=int(SESSION_LIFETIME.total_seconds()),
    same_site="lax",
    https_only=settings.secure_cookies,
)

# Required when the browser frontend calls /auth/me or /auth/logout directly.
# WebSocket Origin validation is handled separately in auth/dependencies.py.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(matchmaking_router, prefix="/v1")
app.include_router(game_router, prefix="/v1")
app.include_router(users_router, prefix="/v1")
app.include_router(friends_router, prefix="/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "healthy"}
