"""A player's finished matches, read from what `record_match` saved.

Only the player can read them for now: public, friends-only, and private history is US-15's privacy
setting, so everyone else gets the same 404 as for a match that doesn't exist.
"""

from collections import defaultdict
from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Match, MatchParticipant, Topic, User
from app.models.match import MatchStatus
from app.repositories.match import MatchRepository
from app.schemas import MatchHistoryPage, MatchRead, MatchSummary, ParticipantRead, TurnRead, UserPublic
from app.services.exceptions import MatchNotFoundError


def outcome_for(match: Match, participant: MatchParticipant) -> Literal["win", "loss", "void"]:
    if match.status == MatchStatus.VOIDED or match.winner_side is None:
        return "void"
    return "win" if match.winner_side == participant.side else "loss"


class MatchHistoryService:
    def __init__(self, session: AsyncSession):
        self.matches = MatchRepository(session)

    async def list_matches(self, viewer: User, user_id: UUID, limit: int, offset: int) -> MatchHistoryPage:
        if viewer.id != user_id:
            raise MatchNotFoundError()
        # Fetch one extra row to learn whether another page exists.
        rows = await self.matches.list_for_player(user_id, limit + 1, offset)
        shown = rows[:limit]
        participants = await self._participants([match.id for match, _, _ in shown])
        return MatchHistoryPage(
            items=[self._summary(match, you, topic, participants[match.id]) for match, you, topic in shown],
            next_offset=offset + limit if len(rows) > limit else None,
        )

    async def get_match(self, viewer: User, match_id: UUID) -> MatchRead:
        row = await self.matches.get_for_player(match_id, viewer.id)
        if row is None:
            raise MatchNotFoundError()
        match, you, topic = row
        participants = await self._participants([match.id])
        return MatchRead(
            **self._summary(match, you, topic, participants[match.id]).model_dump(),
            pro_position=topic.pro_position if topic else None,
            con_position=topic.con_position if topic else None,
            verdict_reasoning=match.verdict_reasoning,
            turns=[
                TurnRead(id=turn.id, index=turn.index, side=turn.side, phase=turn.phase,
                         content=turn.content, truncated=turn.truncated)
                for turn in await self.matches.turns_of(match.id)
            ],
        )

    async def _participants(self, match_ids: list[UUID]) -> dict[UUID, list[ParticipantRead]]:
        found: defaultdict[UUID, list[ParticipantRead]] = defaultdict(list)
        if match_ids:
            for participant, user in await self.matches.participants_of(match_ids):
                found[participant.match_id].append(ParticipantRead(
                    side=participant.side,
                    user=UserPublic.model_validate(user) if user else None,
                    elo_before=participant.elo_before,
                    elo_after=participant.elo_after,
                ))
        return found

    @staticmethod
    def _summary(match: Match, you: MatchParticipant, topic: Topic | None, participants: list[ParticipantRead]) -> MatchSummary:
        return MatchSummary(
            id=match.id,
            topic=topic.topic if topic else None,
            status=match.status,
            winner_side=match.winner_side,
            end_reason=match.end_reason,
            challenge_day=match.challenge_day,
            you=you.side,
            outcome=outcome_for(match, you),
            # Only the caller's own: an opponent's BYOM model is theirs to keep quiet about.
            model=you.model_name,
            participants=sorted(participants, key=lambda participant: participant.side != "pro"),
            ended_at=match.ended_at,
        )
