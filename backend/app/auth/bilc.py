"""BILC access tokens: short-lived HS256 JWTs from `POST /v1/bilc/token` (PROTOCOL.md, "REST — BILC")."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, WebSocket, WebSocketException

from app.config import settings
from app.db.session import SessionFactory
from app.repositories.bilc import BilcRepository

ACCESS_TOKEN_LIFETIME = timedelta(minutes=15)
AUDIENCE = "bilc"
ALGORITHM = "HS256"


@dataclass(frozen=True)
class BilcIdentity:
    device_id: UUID
    user_id: UUID


def issue_access_token(identity: BilcIdentity, now: datetime) -> tuple[str, datetime]:
    expires_at = now + ACCESS_TOKEN_LIFETIME
    token = jwt.encode(
        {
            "sub": str(identity.device_id),
            "uid": str(identity.user_id),
            "aud": AUDIENCE,
            "iat": now,
            "exp": expires_at,
        },
        settings.bilc_jwt_secret,
        algorithm=ALGORITHM,
    )
    return token, expires_at


def decode_access_token(token: str) -> BilcIdentity | None:
    """The token's identity, or None if it is forged, expired, for another audience, or malformed."""
    try:
        claims = jwt.decode(
            token,
            settings.bilc_jwt_secret,
            # Pinning the algorithm rules out `none` and key-confusion tricks.
            algorithms=[ALGORITHM],
            audience=AUDIENCE,
            options={"require": ["sub", "uid", "aud", "exp"]},
        )
        return BilcIdentity(device_id=UUID(claims["sub"]), user_id=UUID(claims["uid"]))
    except (jwt.InvalidTokenError, ValueError, TypeError):
        return None


def bearer_token(websocket: WebSocket) -> str | None:
    scheme, _, token = websocket.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


async def get_bilc_identity(websocket: WebSocket) -> BilcIdentity:
    """Authenticate the BILC socket before `accept()`, without holding a DB session open for it.

    Browsers can't set an Authorization header on a WebSocket, so no Origin check is needed.
    """
    identity = decode_access_token(bearer_token(websocket) or "")
    if identity is None:
        raise WebSocketException(code=4401, reason="Invalid or expired access token")

    async with SessionFactory() as session:
        device = await BilcRepository(session).get(identity.device_id)
    if device is None:
        raise WebSocketException(code=4401, reason="Unknown device")
    # A device only ever plays for the user who paired it.
    if device.revoked_at is not None or device.user_id != identity.user_id:
        raise WebSocketException(code=4403, reason="Device revoked")
    return identity


BilcIdentityDependency = Annotated[BilcIdentity, Depends(get_bilc_identity)]
