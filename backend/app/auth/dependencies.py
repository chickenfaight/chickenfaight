from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.user import User


SessionDependency = Annotated[AsyncSession, Depends(get_session)]


async def get_current_user(
    request: Request,
    session: SessionDependency,
) -> User:
    """Resolve the local user ID stored in the signed session cookie."""
    user_id = request.session.get("user_id")

    try:
        if not isinstance(user_id, str):
            raise ValueError("Session user ID must be a UUID string")
        user_id = UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        ) from None

    user = await session.get(User, user_id)
    if user is None:
        # The database user may have been deleted while an old cookie remains.
        request.session.clear()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    return user


CurrentUserDependency = Annotated[User, Depends(get_current_user)]
