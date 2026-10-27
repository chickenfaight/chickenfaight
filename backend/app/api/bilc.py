from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, WebSocket, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.rate_limit import rate_limit, rate_limit_by_ip
from app.auth.bilc import BilcIdentityDependency
from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas import BilcDeviceRead, BilcRegister, BilcRegistered, BilcTokenRequest, BilcTokens, PairingCodeRead
from app.services.bilc import BilcService
from app.services.bilc_connections import BilcConnections
from app.services.exceptions import TokenReusedError

router = APIRouter(prefix="/bilc", tags=["bilc"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]

# BILC's own routes have no session; the pairing code or refresh token in the body is the credential.
register_limit = rate_limit_by_ip(burst=10, per_minute=10)
token_limit = rate_limit_by_ip(burst=20, per_minute=20)


def connections(request: Request) -> BilcConnections:
    return request.app.state.bilc_connections


# Web app (session)

@router.post("/pairing-codes", response_model=PairingCodeRead, dependencies=[rate_limit(burst=5, per_minute=5)])
async def create_pairing_code(user: CurrentUserDependency, session: SessionDependency) -> PairingCodeRead:
    return await BilcService(session).create_pairing_code(user)


@router.get("/devices", response_model=list[BilcDeviceRead])
async def list_devices(request: Request, user: CurrentUserDependency, session: SessionDependency) -> list[BilcDeviceRead]:
    live = connections(request)
    return await BilcService(session).list_devices(user, live.status, live.size_class)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_device(
    request: Request,
    device_id: UUID,
    user: CurrentUserDependency,
    session: SessionDependency,
) -> None:
    await BilcService(session).revoke(user, device_id)
    await connections(request).close(device_id, 4403, "Device revoked")


# BILC (pairing code or refresh token in the body)

@router.post("/register", response_model=BilcRegistered, dependencies=[register_limit])
async def register_device(body: BilcRegister, session: SessionDependency) -> BilcRegistered:
    return await BilcService(session).register(body)


@router.post("/token", response_model=BilcTokens, dependencies=[token_limit])
async def refresh_token(request: Request, body: BilcTokenRequest, session: SessionDependency) -> BilcTokens:
    try:
        return await BilcService(session).refresh(body.bilc_id, body.refresh_token)
    except TokenReusedError as reused:
        await connections(request).close(reused.device_id, 4403, "Device revoked")
        raise


@router.websocket("/ws")
async def connect_bilc(websocket: WebSocket, identity: BilcIdentityDependency) -> None:
    await websocket.accept()
    await websocket.app.state.bilc_connections.serve(identity, websocket)
