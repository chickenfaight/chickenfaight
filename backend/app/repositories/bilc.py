from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bilc import BilcDevice, BilcPairingCode, BilcSpentRefreshToken


class BilcRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    def add(self, row: BilcDevice | BilcPairingCode | BilcSpentRefreshToken) -> None:
        self.session.add(row)

    async def get(self, device_id: UUID) -> BilcDevice | None:
        return await self.session.get(BilcDevice, device_id)

    async def get_for_update(self, device_id: UUID) -> BilcDevice | None:
        """Serialize rotation and revocation, including changes to the device's spent tokens."""
        statement = select(BilcDevice).where(BilcDevice.id == device_id).with_for_update()
        return await self.session.scalar(statement)

    async def is_spent_token(self, device_id: UUID, token_hash: str, now: datetime) -> bool:
        statement = select(BilcSpentRefreshToken.token_hash).where(
            BilcSpentRefreshToken.device_id == device_id,
            BilcSpentRefreshToken.token_hash == token_hash,
            BilcSpentRefreshToken.expires_at > now,
        )
        return await self.session.scalar(statement) is not None

    async def delete_spent_tokens(self, device_id: UUID, *, expired_by: datetime | None = None) -> None:
        statement = delete(BilcSpentRefreshToken).where(BilcSpentRefreshToken.device_id == device_id)
        if expired_by is not None:
            statement = statement.where(BilcSpentRefreshToken.expires_at <= expired_by)
        await self.session.execute(statement)

    async def list_active(self, user_id: UUID) -> list[BilcDevice]:
        statement = (
            select(BilcDevice)
            .where(BilcDevice.user_id == user_id, BilcDevice.revoked_at.is_(None))
            .order_by(BilcDevice.created_at.desc(), BilcDevice.id)
        )
        return list(await self.session.scalars(statement))

    async def use_pairing_code(self, code_hash: str, now: datetime) -> UUID | None:
        """Mark an unused, unexpired code used and return its user. One statement, so a code works once."""
        statement = (
            update(BilcPairingCode)
            .where(
                BilcPairingCode.code_hash == code_hash,
                BilcPairingCode.used_at.is_(None),
                BilcPairingCode.expires_at > now,
            )
            .values(used_at=now)
            .returning(BilcPairingCode.user_id)
        )
        return await self.session.scalar(statement)

    async def delete_stale_codes(self, user_id: UUID, now: datetime) -> None:
        await self.session.execute(
            delete(BilcPairingCode).where(
                BilcPairingCode.user_id == user_id,
                or_(BilcPairingCode.used_at.is_not(None), BilcPairingCode.expires_at <= now),
            )
        )
