from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bilc import BilcDevice, BilcPairingCode


class BilcRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    def add(self, row: BilcDevice | BilcPairingCode) -> None:
        self.session.add(row)

    async def get(self, device_id: UUID) -> BilcDevice | None:
        return await self.session.get(BilcDevice, device_id)

    async def get_for_update(self, device_id: UUID) -> BilcDevice | None:
        """Lock the row, so two refreshes with the same token can't both rotate it."""
        statement = select(BilcDevice).where(BilcDevice.id == device_id).with_for_update()
        return await self.session.scalar(statement)

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
