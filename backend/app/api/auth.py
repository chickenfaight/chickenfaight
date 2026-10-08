from typing import Annotated

from authlib.integrations.base_client.errors import OAuthError
from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import RedirectResponse

from app.auth.dependencies import CurrentUserDependency
from app.auth.google import oauth
from app.config import settings
from app.db.session import get_session
from app.schemas import GoogleIdentity, UserRead, LoginData
from app.services.auth_session import SessionService
from app.services.user import UserService
from app.models.user import User


router = APIRouter(prefix="/auth", tags=["auth"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


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
    token = await SessionService(session).start(user)

    # Starlette's cookie is signed but readable, so store only the random session token
    # (hashed in the database), never Google's tokens or client credentials.
    request.session.clear()
    request.session["session_token"] = token

    return RedirectResponse(settings.frontend_url)


@router.post("/signup", status_code=status.HTTP_204_NO_CONTENT)
async def create_account(user_data: LoginData, request: Request, session: SessionDependency) -> Response:
    """Attempt to create a new user account using user_data."""
    if user_data.username is None or user_data.email is None or user_data.password_salt is None or user_data.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed user creation packet",
        )

    user = await UserService(session).create_account(user_data)
    token = await SessionService(session).start(user)

    # Starlette's cookie is signed but readable, so store only the random session token
    # (hashed in the database), never Google's tokens or client credentials.
    request.session.clear()
    request.session["session_token"] = token

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
async def password_login(user_data: LoginData, request: Request, session: SessionDependency) -> Response:
    """Attempt to sign in to an account using user_data. Not compatible with Google-linked accounts."""
    if user_data.username is None or user_data.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed sign-in packet",
        )
    user = await UserService(session).sign_in_with_password(user_data)
    token = await SessionService(session).start(user)

    # Starlette's cookie is signed but readable, so store only the random session token
    # (hashed in the database), never Google's tokens or client credentials.
    request.session.clear()
    request.session["session_token"] = token

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
    
