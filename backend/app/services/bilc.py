"""Pairing and authenticating BILC devices (PROTOCOL.md, "REST — BILC"; BILC.md, "Pairing and auth flow").

Pairing codes and refresh tokens are random strings from `secrets`; only their SHA-256 hashes are stored.
"""

import hmac
import secrets
import string
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.bilc import BilcIdentity, issue_access_token
from app.models.bilc import BilcDevice, BilcPairingCode
from app.models.user import User
from app.repositories.bilc import BilcRepository
from app.schemas import BilcDeviceRead, BilcRegister, BilcRegistered, BilcTokens, Hello, PairingCodeRead
from app.services.auth_session import hash_token
from app.services.bilc_rules import size_class
from app.services.exceptions import (
    BilcDeviceNotFoundError,
    PairingCodeInvalidError,
    TokenInvalidError,
    TokenReusedError,
)

PAIRING_CODE_LIFETIME = timedelta(minutes=10)
REFRESH_TOKEN_LIFETIME = timedelta(days=30)
PAIRING_CODE_LENGTH = 8
PAIRING_CODE_ALPHABET = string.ascii_uppercase + "23456789"


def new_refresh_token() -> str:
    return secrets.token_urlsafe(32)


class BilcService:
    """Device pairing, token rotation, and the owner's device list.

    Web routes use `CurrentUserDependency`, whose user lookup already began the transaction, so they
    finish with `commit()`; BILC's own routes have no user and open one with `begin()`.
    """

    def __init__(self, session: AsyncSession):
        self.session = session
        self.devices = BilcRepository(session)

    async def create_pairing_code(self, user: User) -> PairingCodeRead:
        now = datetime.now(timezone.utc)
        code = "".join(secrets.choice(PAIRING_CODE_ALPHABET) for _ in range(PAIRING_CODE_LENGTH))
        expires_at = now + PAIRING_CODE_LIFETIME
        await self.devices.delete_stale_codes(user.id, now)
        self.devices.add(BilcPairingCode(code_hash=hash_token(code), user_id=user.id, expires_at=expires_at))
        await self.session.commit()
        return PairingCodeRead(code=code, expires_at=expires_at)

    async def register(self, data: BilcRegister) -> BilcRegistered:
        now = datetime.now(timezone.utc)
        refresh_token = new_refresh_token()
        async with self.session.begin():
            user_id = await self.devices.use_pairing_code(hash_token(data.pairing_code), now)
            if user_id is None:
                raise PairingCodeInvalidError()
            device = BilcDevice(
                user_id=user_id,
                name=data.device_name,
                platform=data.platform,
                client_version=data.client_version,
                refresh_token_hash=hash_token(refresh_token),
                refresh_token_expires_at=now + REFRESH_TOKEN_LIFETIME,
                last_seen_at=now,
            )
            self.devices.add(device)
            await self.session.flush()
            device_id = device.id
        return BilcRegistered(bilc_id=device_id, refresh_token=refresh_token)

    async def refresh(self, device_id: UUID, refresh_token: str) -> BilcTokens:
        """Exchange a refresh token for an access token and a new refresh token.

        Each refresh token works once. Presenting the one just replaced means two copies exist,
        so the device is revoked (`TokenReusedError`) and must be paired again.
        """
        now = datetime.now(timezone.utc)
        presented = hash_token(refresh_token)
        new_token = new_refresh_token()
        async with self.session.begin():
            device = await self.devices.get_for_update(device_id)
            if device is None or device.revoked_at is not None or device.refresh_token_hash is None:
                raise TokenInvalidError()
            if hmac.compare_digest(presented, device.refresh_token_hash):
                if device.refresh_token_expires_at is None or device.refresh_token_expires_at <= now:
                    # Unused for 30 days: pair again.
                    raise TokenInvalidError()
                device.previous_refresh_token_hash = device.refresh_token_hash
                device.refresh_token_hash = hash_token(new_token)
                device.refresh_token_expires_at = now + REFRESH_TOKEN_LIFETIME
                device.last_seen_at = now
                identity = BilcIdentity(device_id=device.id, user_id=device.user_id)
            elif device.previous_refresh_token_hash and hmac.compare_digest(
                presented, device.previous_refresh_token_hash,
            ):
                revoke(device, now)
                identity = None
            else:
                raise TokenInvalidError()
        if identity is None:
            # Raised after the block, so the revocation is committed rather than rolled back.
            raise TokenReusedError(device_id)
        access_token, expires_at = issue_access_token(identity, now)
        return BilcTokens(access_token=access_token, expires_at=expires_at, refresh_token=new_token)

    async def list_devices(
        self,
        user: User,
        status: Callable[[UUID], str],
        live_size_class: Callable[[UUID], str | None],
    ) -> list[BilcDeviceRead]:
        """The caller's devices, with each one's live offline/idle/busy state, and its size class
        from its current connection if it has one, else from what it last reported."""
        devices = await self.devices.list_active(user.id)
        await self.session.commit()
        return [
            BilcDeviceRead(
                id=device.id,
                name=device.name,
                platform=device.platform,
                client_version=device.client_version,
                model_name=(device.model_metadata or {}).get("name"),
                size_class=live_size_class(device.id) or (size_class(device.model_metadata) if device.model_metadata else None),
                online=status(device.id) != "offline",
                status=status(device.id),
                last_seen_at=device.last_seen_at,
                created_at=device.created_at,
            )
            for device in devices
        ]

    async def get_owned(self, user: User, device_id: UUID) -> BilcDevice:
        """The caller's unrevoked device; anyone else's looks missing."""
        device = await self.devices.get(device_id)
        if device is None or device.user_id != user.id or device.revoked_at is not None:
            raise BilcDeviceNotFoundError()
        return device

    async def revoke(self, user: User, device_id: UUID) -> None:
        device = await self.devices.get(device_id)
        # Someone else's device looks the same as a missing one.
        if device is None or device.user_id != user.id or device.revoked_at is not None:
            await self.session.rollback()
            raise BilcDeviceNotFoundError()
        revoke(device, datetime.now(timezone.utc))
        await self.session.commit()

    async def record_hello(self, device_id: UUID, hello: Hello) -> None:
        async with self.session.begin():
            device = await self.devices.get(device_id)
            if device is None:
                return
            device.client_version = hello.client_version
            device.platform = hello.platform
            device.model_metadata = hello.model.model_dump()
            device.last_seen_at = datetime.now(timezone.utc)


def revoke(device: BilcDevice, now: datetime) -> None:
    device.revoked_at = now
    device.refresh_token_hash = None
    device.previous_refresh_token_hash = None
    device.refresh_token_expires_at = None
