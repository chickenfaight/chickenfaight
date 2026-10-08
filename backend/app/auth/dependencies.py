from typing import Annotated, NoReturn
from uuid import UUID

from fastapi import Depends, HTTPException, WebSocket, WebSocketException, status
from fastapi.requests import HTTPConnection
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import SessionFactory, get_session
from app.models.user import User
from app.services.auth_session import SessionService


SessionDependency = Annotated[AsyncSession, Depends(get_session)]


def reject_unauthenticated(connection: HTTPConnection) -> NoReturn:
    if connection.scope["type"] == "websocket":
        raise WebSocketException(code=4401, reason="Not authenticated")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )


async def get_current_user(
    connection: HTTPConnection,
    session: SessionDependency,
) -> User:
    """Resolve the session token in the signed cookie against the `sessions` table."""
    token = connection.session.get("session_token")
    if not isinstance(token, str) or not token:
        reject_unauthenticated(connection)

    user = await SessionService(session).resolve(token)
    if user is None:
        # Expired, logged out, or its user was deleted: drop the stale cookie too.
        connection.session.clear()
        reject_unauthenticated(connection)

    return user


CurrentUserDependency = Annotated[User, Depends(get_current_user)]


async def get_websocket_user_id(websocket: WebSocket) -> UUID:
    """Authenticate the handshake without retaining a DB session for the socket."""
    if websocket.headers.get("origin") != settings.frontend_url.rstrip("/"):
        raise WebSocketException(code=4403, reason="Origin not allowed")

    async with SessionFactory() as session:
        user = await get_current_user(websocket, session)
        user_id = user.id

    return user_id


WebSocketUserIdDependency = Annotated[UUID, Depends(get_websocket_user_id)]
