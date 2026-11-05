from datetime import timedelta
from uuid import uuid4

from sqlalchemy import func, select, update

from app.models import FriendRequest, Friendship, UserBlock

BLOCK = "/v1/block"
REQUESTS = "/v1/friends/requests"
PROFILE = "/v1/users/by-tag/"


async def befriend(client, log_in, first, second) -> None:
    log_in(first)
    assert (await client.put(f"{REQUESTS}/{second.id}")).status_code == 200
    log_in(second)
    assert (await client.post(f"{REQUESTS}/{first.id}/accept")).status_code == 204


async def test_blocked_player_cant_see_the_profile(client, log_in, make_user):
    blocker, blocked = await make_user("blocker"), await make_user("blocked")
    log_in(blocker)
    assert (await client.put(f"{BLOCK}/{blocked.id}")).status_code == 204
    profile = (await client.get(f"{PROFILE}blocked")).json()
    assert profile["is_blocked"] is True
    assert profile["read_blocked"] is False

    log_in(blocked)
    profile = (await client.get(f"{PROFILE}blocker")).json()
    # Only the ID and tag, so the blocked player can block back; nothing else of the blocker's.
    assert profile == {
        "id": str(blocker.id), "tag": "blocker", "username": None, "avatar_url": None,
        "ratings": [], "read_blocked": True, "is_friend": False, "friend_request": None,
        "is_blocked": False, "points": 0, "streak": 0, "rank": None,
    }


async def test_unblocking_restores_the_profile(client, log_in, make_user):
    blocker, blocked = await make_user("blocker"), await make_user("blocked")
    log_in(blocker)
    await client.put(f"{BLOCK}/{blocked.id}")
    assert (await client.delete(f"{BLOCK}/{blocked.id}")).status_code == 204
    assert (await client.get(f"{PROFILE}blocked")).json()["is_blocked"] is False
    log_in(blocked)
    profile = (await client.get(f"{PROFILE}blocker")).json()
    assert profile["read_blocked"] is False
    assert profile["id"] == str(blocker.id)


async def test_blocking_and_unblocking_are_idempotent(client, log_in, make_user, db_session):
    blocker, blocked = await make_user("blocker"), await make_user("blocked")
    log_in(blocker)
    for _ in range(2):
        assert (await client.put(f"{BLOCK}/{blocked.id}")).status_code == 204
    assert await db_session.scalar(select(func.count()).select_from(UserBlock)) == 1
    for _ in range(2):
        assert (await client.delete(f"{BLOCK}/{blocked.id}")).status_code == 204
    assert await db_session.scalar(select(func.count()).select_from(UserBlock)) == 0


async def test_unblocking_leaves_the_other_players_block(client, log_in, make_user):
    first, second = await make_user("first"), await make_user("second")
    log_in(first)
    await client.put(f"{BLOCK}/{second.id}")
    log_in(second)
    await client.put(f"{BLOCK}/{first.id}")
    log_in(first)
    # Still blocked by `second`, `first` sees their own block and can lift it.
    profile = (await client.get(f"{PROFILE}second")).json()
    assert (profile["read_blocked"], profile["is_blocked"]) == (True, True)
    await client.delete(f"{BLOCK}/{second.id}")
    profile = (await client.get(f"{PROFILE}second")).json()
    assert (profile["read_blocked"], profile["is_blocked"]) == (True, False)


async def test_blocking_ends_friendship_and_requests(client, log_in, make_user, db_session):
    blocker, friend, asker = await make_user("blocker"), await make_user("friend"), await make_user("asker")
    await befriend(client, log_in, blocker, friend)
    log_in(asker)
    await client.put(f"{REQUESTS}/{blocker.id}")
    log_in(blocker)
    await client.put(f"{BLOCK}/{friend.id}")
    await client.put(f"{BLOCK}/{asker.id}")
    assert await db_session.scalar(select(func.count()).select_from(Friendship)) == 0
    assert await db_session.scalar(select(func.count()).select_from(FriendRequest)) == 0


async def test_neither_player_can_send_a_request(client, log_in, make_user):
    blocker, blocked = await make_user("blocker"), await make_user("blocked")
    log_in(blocker)
    await client.put(f"{BLOCK}/{blocked.id}")
    response = await client.put(f"{REQUESTS}/{blocked.id}")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"
    log_in(blocked)
    response = await client.put(f"{REQUESTS}/{blocker.id}")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


async def test_blocking_yourself_is_refused(client, log_in, make_user):
    user = await make_user("self")
    log_in(user)
    response = await client.put(f"{BLOCK}/{user.id}")
    assert response.status_code == 422
    assert response.json()["code"] == "BLOCK_SELF"


async def test_blocking_an_unknown_or_untagged_player_is_not_found(client, log_in, make_user):
    blocker, untagged = await make_user("blocker"), await make_user()
    log_in(blocker)
    for target in (uuid4(), untagged.id):
        response = await client.put(f"{BLOCK}/{target}")
        assert response.status_code == 404
        assert response.json()["code"] == "NOT_FOUND"


async def test_deleted_user_leaves_no_blocks(client, log_in, make_user, db_session):
    blocker, blocked = await make_user("blocker"), await make_user("blocked")
    log_in(blocker)
    await client.put(f"{BLOCK}/{blocked.id}")
    assert (await client.delete("/v1/users/me")).status_code == 204
    assert await db_session.scalar(select(func.count()).select_from(UserBlock)) == 0


async def test_block_changes_are_rate_limited(client, log_in, make_user):
    blocker, blocked = await make_user("blocker"), await make_user("blocked")
    log_in(blocker)
    codes = [(await client.put(f"{BLOCK}/{blocked.id}")).status_code for _ in range(11)]
    assert codes[:10] == [204] * 10
    assert codes[10] == 429


# Listing

async def blocked_tags(client, **params) -> list[str]:
    response = await client.get(BLOCK, params=params)
    assert response.status_code == 200
    return [item["tag"] for item in response.json()["items"]]


async def test_list_shows_only_the_callers_blocks_newest_first(client, log_in, make_user, db_session):
    blocker, first, second = await make_user("blocker"), await make_user("first"), await make_user("second")
    log_in(blocker)
    assert await blocked_tags(client) == []
    await client.put(f"{BLOCK}/{first.id}")
    await client.put(f"{BLOCK}/{second.id}")
    # `now()` is fixed for the test's whole transaction, so give the blocks distinct times.
    for blocked, minutes_ago in ((first, 2), (second, 1)):
        await db_session.execute(
            update(UserBlock)
            .where(UserBlock.blocked_id == blocked.id)
            .values(created_at=func.now() - timedelta(minutes=minutes_ago))
        )
    await db_session.commit()
    assert await blocked_tags(client) == ["second", "first"]
    # Being blocked doesn't put the blocker on your list.
    log_in(first)
    assert await blocked_tags(client) == []


async def test_list_carries_only_public_fields(client, log_in, make_user, db_session):
    blocker, blocked = await make_user("blocker"), await make_user("blocked")
    blocked.email = "secret@example.com"
    await db_session.commit()
    log_in(blocker)
    await client.put(f"{BLOCK}/{blocked.id}")
    response = await client.get(BLOCK)
    assert set(response.json()["items"][0]) == {"id", "tag", "username", "avatar_url"}
    assert "secret@example.com" not in response.text


async def test_list_pages(client, log_in, make_user):
    blocker = await make_user("blocker")
    log_in(blocker)
    for index in range(3):
        await client.put(f"{BLOCK}/{(await make_user(f'player{index}')).id}")
    first = (await client.get(BLOCK, params={"limit": 2})).json()
    assert len(first["items"]) == 2
    assert first["next_offset"] == 2
    rest = (await client.get(BLOCK, params={"limit": 2, "offset": 2})).json()
    assert len(rest["items"]) == 1
    assert rest["next_offset"] is None


async def test_unblocked_players_leave_the_list(client, log_in, make_user):
    blocker, blocked = await make_user("blocker"), await make_user("blocked")
    log_in(blocker)
    await client.put(f"{BLOCK}/{blocked.id}")
    await client.delete(f"{BLOCK}/{blocked.id}")
    assert await blocked_tags(client) == []
