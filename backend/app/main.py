from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.api.auth import router as auth_router
from app.api.exception_handlers import register_exception_handlers
from app.api.matchmaking import router as matchmaking_router
from app.config import settings
from app.db.session import engine
from app.services.matchmaking import Matchmaker


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.matchmaker = Matchmaker()
    yield
    await engine.dispose()


app = FastAPI(lifespan=lifespan)

register_exception_handlers(app)

# This signed cookie temporarily carries OAuth state during the redirect and
# later carries our local `user_id`. Use HTTPS-only cookies in production.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    same_site="lax",
    https_only=settings.secure_cookies,
)

# Required when the browser frontend calls /auth/me or /auth/logout directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(matchmaking_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "healthy"}
