"""Real commits on independent connections; cleanup owns only these users/results."""
import asyncio
from dataclasses import replace
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BilcDevice, UserBlock, ChallengeCompletion, FriendRequest, Friendship, Ladder, Match, MatchParticipant, Rating, User
from app.schemas import BilcRegister, SignupData
from app.services.bilc import BilcService
from app.services.exceptions import FriendRequestNotFoundError, PairingCodeInvalidError, TagTakenError, TokenReusedError
from app.services.friend import FriendService
from app.services.rewards import record_match
from app.services.user import UserService
from test_rewards import NOON, report


@pytest.fixture
async def committed_players(db_engine):
    users = [User(tag=f"race_{uuid4().hex[:10]}", google_sub=f"race-{uuid4()}") for _ in range(3)]
    async with AsyncSession(db_engine, expire_on_commit=False) as session:
        session.add_all(users)
        await session.commit()
    yield users
    async with AsyncSession(db_engine) as session:
        await session.execute(delete(User).where(User.id.in_([u.id for u in users])))
        await session.commit()


async def test_pairing_code_is_consumed_once_under_contention(db_engine, committed_players):
    owner = committed_players[0]
    async with AsyncSession(db_engine) as session:
        code = (await BilcService(session).create_pairing_code(owner)).code

    async def register():
        async with AsyncSession(db_engine) as session:
            try:
                return await BilcService(session).register(BilcRegister(
                    pairing_code=code, device_name="race", platform="test", client_version="0.1.0"))
            except PairingCodeInvalidError as exc:
                return exc

    results = await asyncio.wait_for(asyncio.gather(register(), register()), 5)
    assert sum(isinstance(r, PairingCodeInvalidError) for r in results) == 1
    async with AsyncSession(db_engine) as session:
        assert await session.scalar(select(func.count()).select_from(BilcDevice).where(BilcDevice.user_id == owner.id)) == 1


async def test_simultaneous_refresh_detects_reuse_and_revokes(db_engine, committed_players):
    owner = committed_players[0]
    async with AsyncSession(db_engine) as session:
        code = (await BilcService(session).create_pairing_code(owner)).code
        paired = await BilcService(session).register(BilcRegister(
            pairing_code=code, device_name="race", platform="test", client_version="0.1.0"))

    async def refresh():
        async with AsyncSession(db_engine) as session:
            try:
                return await BilcService(session).refresh(paired.bilc_id, paired.refresh_token)
            except TokenReusedError as exc:
                return exc

    results = await asyncio.wait_for(asyncio.gather(refresh(), refresh()), 5)
    assert sum(isinstance(r, TokenReusedError) for r in results) == 1
    async with AsyncSession(db_engine) as session:
        device = await session.get(BilcDevice, paired.bilc_id)
        assert device.revoked_at is not None and device.refresh_token_hash is None


async def test_case_insensitive_signup_collision_returns_one_taken(db_engine):
    tag = f"race_{uuid4().hex[:10]}"

    async def signup(value):
        async with AsyncSession(db_engine) as session:
            try:
                return await UserService(session).create_account(SignupData(
                    tag=value, username="Race", password="a-test-password"))
            except TagTakenError as exc:
                return exc

    try:
        results = await asyncio.wait_for(asyncio.gather(signup(tag), signup(tag.upper())), 5)
        assert sum(isinstance(r, TagTakenError) for r in results) == 1
    finally:
        async with AsyncSession(db_engine) as session:
            await session.execute(delete(User).where(func.lower(User.tag) == tag))
            await session.commit()


async def test_block_racing_accept_leaves_no_relationship(db_engine, committed_players):
    sender, receiver, _ = committed_players
    async with AsyncSession(db_engine) as session:
        await FriendService(session).send_request(sender, receiver.id)

    async def block():
        async with AsyncSession(db_engine) as session:
            await FriendService(session).block(sender, receiver.id)

    async def accept():
        async with AsyncSession(db_engine) as session:
            try:
                await FriendService(session).accept_request(receiver, sender.id)
            except FriendRequestNotFoundError:
                pass  # Blocking won the lock and removed the request.

    await asyncio.wait_for(asyncio.gather(block(), accept()), 5)
    async with AsyncSession(db_engine) as session:
        assert await session.get(UserBlock, (sender.id, receiver.id)) is not None
        assert await session.scalar(select(func.count()).select_from(Friendship).where(Friendship.user_id.in_([sender.id, receiver.id]))) == 0
        assert await session.scalar(select(func.count()).select_from(FriendRequest).where(FriendRequest.sender_id == sender.id)) == 0


async def test_overlapping_results_preserve_rewards_ratings_and_one_daily_bonus(db_engine, committed_players):
    first, second, _ = committed_players
    slug = f"race-{uuid4()}"
    async with AsyncSession(db_engine, expire_on_commit=False) as session:
        ladder = Ladder(slug=slug, display_name="Race", kind="cloud")
        session.add(ladder)
        await session.commit()
    reports = [replace(report(first, second, challenge_day=NOON.date()), rating_ladder_slug=slug) for _ in range(2)]
    # Reverse lock acquisition input order for one report to exercise stable ordering.
    reports[1] = replace(reports[1], sides=dict(reversed(list(reports[1].sides.items()))))

    async def record(r):
        async with AsyncSession(db_engine) as session:
            await record_match(session, r)

    try:
        await asyncio.wait_for(asyncio.gather(*(record(r) for r in reports)), 5)
        # Replay concurrently as well; no increments on either replay.
        await asyncio.wait_for(asyncio.gather(*(record(reports[0]) for _ in range(2))), 5)
        async with AsyncSession(db_engine) as session:
            a, b = await session.get(User, first.id), await session.get(User, second.id)
            assert (a.points, b.points, a.streak, b.streak) == (90, 70, 1, 1)
            ratings = list(await session.scalars(select(Rating).where(Rating.ladder_id == ladder.id)))
            assert all(r.games_played == 2 for r in ratings)
            assert sorted(r.elo for r in ratings) == [969, 1031]
            assert await session.scalar(select(func.count()).select_from(ChallengeCompletion).where(ChallengeCompletion.user_id.in_([first.id, second.id]))) == 2
    finally:
        async with AsyncSession(db_engine) as session:
            await session.execute(delete(Match).where(Match.id.in_([r.match_id for r in reports])))
            await session.execute(delete(Ladder).where(Ladder.id == ladder.id))
            await session.commit()


async def test_account_deletion_racing_result_preserves_opponent_history(db_engine, committed_players):
    first, second, _ = committed_players
    r = report(first, second, challenge_day=NOON.date())

    async def record():
        async with AsyncSession(db_engine) as session:
            await record_match(session, r)

    async def remove():
        async with AsyncSession(db_engine) as session:
            await session.execute(delete(User).where(User.id == second.id))
            await session.commit()

    try:
        await asyncio.wait_for(asyncio.gather(record(), remove()), 5)
        async with AsyncSession(db_engine) as session:
            rows = list(await session.scalars(select(MatchParticipant).where(MatchParticipant.match_id == r.match_id)))
            assert {row.user_id for row in rows} == {None, first.id}
            survivor = await session.get(User, first.id)
            assert survivor.points == 70
    finally:
        async with AsyncSession(db_engine) as session:
            await session.execute(delete(Match).where(Match.id == r.match_id))
            await session.commit()
