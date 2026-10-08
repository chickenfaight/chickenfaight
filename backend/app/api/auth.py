from typing import Annotated

from authlib.integrations.base_client.errors import OAuthError
from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import RedirectResponse

from app.api.rate_limit import TokenBucket, rate_limit_by_ip
from app.auth.dependencies import CurrentUserDependency
from app.auth.google import oauth
from app.config import settings
from app.db.session import get_session
from app.schemas import GoogleIdentity, LoginData, SignupData, UserRead
from app.services.auth_session import SessionService
from app.services.user import UserService


router = APIRouter(prefix="/auth", tags=["auth"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]

# Password guessing is limited per IP and, so many IPs can't share the work, per tag.
login_ip_limit = rate_limit_by_ip(burst=10, per_minute=10)
login_tag_limit = TokenBucket(burst=5, per_minute=1)
signup_ip_limit = rate_limit_by_ip(burst=5, per_minute=1)


def start_cookie_session(request: Request, token: str) -> None:
    # Starlette's cookie is signed but readable, so store only the random session token
    # (hashed in the database), never passwords, Google's tokens, or client credentials.
    request.session.clear()
    request.session["session_token"] = token


@router.get("/google/login")
async def google_login(request: Request) -> Response:
    """Step 1: redirect the browser to Google's authorization page."""
    google = oauth.create_client("google")
    if google is None:
        raise RuntimeError("Google OAuth client is not registered")

    redirect_uri = request.url_for("google_callback")
    return await google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback", name="google_callback")
async def google_callback(
    request: Request,
    session: SessionDependency,
) -> Response:
    """Steps 2-4: exchange the code, upsert the user, start a session."""
    google = oauth.create_client("google")
    if google is None:
        raise RuntimeError("Google OAuth client is not registered")

    try:
        # Authlib validates OAuth state, exchanges Google's short-lived code,
        # validates the OpenID Connect ID token, and exposes its userinfo.
        token = await google.authorize_access_token(request)
        identity = GoogleIdentity.model_validate(token.get("userinfo"))
    except (OAuthError, ValidationError):
        return RedirectResponse(f"{settings.frontend_url.rstrip('/')}/login")

    if identity.email is not None and not identity.email_verified:
        return RedirectResponse(f"{settings.frontend_url.rstrip('/')}/login")

    user = await UserService(session).sign_in_with_google(identity)
    start_cookie_session(request, await SessionService(session).start(user))

    return RedirectResponse(settings.frontend_url)


@router.post("/signup", status_code=status.HTTP_204_NO_CONTENT, dependencies=[signup_ip_limit])
async def create_account(data: SignupData, request: Request, session: SessionDependency) -> Response:
    """Create a password account with its tag, and sign it in."""
    user = await UserService(session).create_account(data)
    start_cookie_session(request, await SessionService(session).start(user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT, dependencies=[login_ip_limit])
async def password_login(data: LoginData, request: Request, session: SessionDependency) -> Response:
    """Sign in with a tag and password. Google-only accounts have no password and always fail."""
    login_tag_limit.check(data.tag.lower())
    user = await UserService(session).sign_in_with_password(data)
    start_cookie_session(request, await SessionService(session).start(user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserRead)
async def read_current_user(user: CurrentUserDependency) -> UserRead:
    """Validate the session cookie against the database; 401 if missing, expired, or logged out."""
    return UserRead.model_validate(user)    

@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, session: SessionDependency) -> Response:
    """End the session in the database, so the token stops working everywhere, and clear the cookie."""
    token = request.session.get("session_token")
    if isinstance(token, str) and token:
        await SessionService(session).end(token)
    request.session.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
    
