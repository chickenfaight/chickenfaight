from typing import Annotated

from authlib.integrations.base_client.errors import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import RedirectResponse

from app.auth.dependencies import CurrentUserDependency
from app.auth.google import oauth
from app.config import settings
from app.db.session import get_session
from app.schemas import GoogleIdentity
from app.schemas import UserRead
from app.services.user import UserService


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
    except (OAuthError, ValidationError) as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google sign-in could not be verified",
        ) from error

    if identity.email is not None and not identity.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google did not provide a verified email address",
        )

    user = await UserService(session).sign_in_with_google(identity)

    # Starlette's cookie is signed but readable, so store only the local ID,
    # never Google's access token, refresh token, or client credentials.
    request.session.clear()
    request.session["user_id"] = user.id

    return RedirectResponse(settings.frontend_url)


@router.get("/me", response_model=UserRead)
async def read_current_user(user: CurrentUserDependency) -> UserRead:
    """Demonstrate using the cookie to load the local database user."""
    return UserRead.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request) -> Response:
    """Delete the local login cookie; no Google token is persisted here."""
    request.session.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
