import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FriendRequest, Friendship, User
from app.services.friend import FriendService

FRIENDS = "/v1/friends"
REQUESTS = "/v1/friends/requests"
PROFILE = "/v1/users/by-tag/"


async def friend_tags(client, **params) -> list[str]:
    response = await client.get(FRIENDS, params=params)
    assert response.status_code == 200
    return [item["tag"] for item in response.json()["items"]]


async def request_tags(client, direction: str = "incoming", **params) -> list[str]:
    response = await client.get(REQUESTS, params={"direction": direction, **params})
    assert response.status_code == 200
    return [item["tag"] for item in response.json()["items"]]


async def befriend(client, log_in, first, second) -> None:
    log_in(first)
    assert (await client.put(f"{REQUESTS}/{second.id}")).status_code == 200
    log_in(second)
    assert (await client.post(f"{REQUESTS}/{first.id}/accept")).status_code == 204


def relation(profile: dict) -> tuple[bool, str | None]:
    return profile["is_friend"], profile["friend_request"]


# Sending

async def test_sending_a_request_doesnt_make_friends_yet(client, log_in, make_user):
    target = await make_user("Rooster_42")
    sender = await make_user("sender")
    log_in(sender)
    response = await client.put(f"{REQUESTS}/{target.id}")
    assert response.status_code == 200
    assert response.json() == {"is_friend": False, "friend_request": "sent"}
    assert await friend_tags(client) == []
    assert await request_tags(client, "outgoing") == ["Rooster_42"]
    assert await request_tags(client, "incoming") == []
    log_in(target)
    assert await friend_tags(client) == []
    assert await request_tags(client, "incoming") == ["sender"]
    assert await request_tags(client, "outgoing") == []


async def test_sending_twice_is_idempotent(client, log_in, make_user, db_session):
    target = await make_user("Rooster_42")
    sender = await make_user("sender")
    log_in(sender)
    for _ in range(2):
        assert (await client.put(f"{REQUESTS}/{target.id}")).json()["friend_request"] == "sent"
    count = await db_session.scalar(select(func.count()).select_from(FriendRequest).where(FriendRequest.sender_id == sender.id))
    assert count == 1


async def test_requesting_someone_who_asked_you_makes_friends(client, log_in, make_user, db_session):
    first, second = await make_user("first"), await make_user("second")
    log_in(first)
    await client.put(f"{REQUESTS}/{second.id}")
    log_in(second)
    response = await client.put(f"{REQUESTS}/{first.id}")
    assert response.status_code == 200
    assert response.json() == {"is_friend": True, "friend_request": None}
    assert await friend_tags(client) == ["first"]
    assert await request_tags(client) == []
    assert await db_session.scalar(select(func.count()).select_from(FriendRequest)) == 0


async def test_requesting_a_friend_changes_nothing(client, log_in, make_user):
    first, second = await make_user("first"), await make_user("second")
    await befriend(client, log_in, first, second)
    response = await client.put(f"{REQUESTS}/{first.id}")
    assert response.json() == {"is_friend": True, "friend_request": None}
    assert await request_tags(client, "outgoing") == []


async def test_cannot_request_self(client, log_in, make_user):
    viewer = await make_user("viewer")
    log_in(viewer)
    response = await client.put(f"{REQUESTS}/{viewer.id}")
    assert response.status_code == 422
    assert response.json()["code"] == "FRIEND_SELF"


async def test_request_to_unknown_or_untagged_player_is_not_found(client, log_in, make_user):
    untagged = await make_user()
    log_in(await make_user("viewer"))
    for target in (uuid4(), untagged.id):
        response = await client.put(f"{REQUESTS}/{target}")
        assert response.status_code == 404
        assert response.json()["code"] == "NOT_FOUND"


async def test_sender_needs_a_tag(client, log_in, make_user):
    target = await make_user("Rooster_42")
    log_in(await make_user())
    response = await client.put(f"{REQUESTS}/{target.id}")
    assert response.status_code == 403
    assert response.json()["code"] == "TAG_REQUIRED"


async def test_old_add_friend_route_is_gone(client, log_in, make_user):
    target = await make_user("Rooster_42")
    log_in(await make_user("viewer"))
    assert (await client.put(f"{FRIENDS}/{target.id}")).status_code == 405


@pytest.mark.parametrize(("method", "path"), [
    ("PUT", "/not-a-uuid"), ("POST", "/not-a-uuid/accept"), ("DELETE", "/not-a-uuid"),
])
async def test_request_routes_reject_malformed_ids(client, log_in, make_user, method, path):
    log_in(await make_user("viewer"))
    assert (await client.request(method, REQUESTS + path)).status_code == 422


# Answering

async def test_accepting_makes_both_players_friends(client, log_in, make_user, db_session):
    first, second = await make_user("first"), await make_user("second")
    await befriend(client, log_in, first, second)
    assert await friend_tags(client) == ["first"]
    log_in(first)
    assert await friend_tags(client) == ["second"]
    assert await request_tags(client, "outgoing") == []
    assert await db_session.scalar(select(func.count()).select_from(FriendRequest)) == 0


async def test_only_the_receiver_can_accept(client, log_in, make_user):
    sender, target = await make_user("sender"), await make_user("target")
    log_in(sender)
    await client.put(f"{REQUESTS}/{target.id}")
    # The sender can't accept their own request, and nor can anyone else.
    response = await client.post(f"{REQUESTS}/{target.id}/accept")
    assert response.status_code == 404 and response.json()["code"] == "NOT_FOUND"
    log_in(await make_user("intruder"))
    assert (await client.post(f"{REQUESTS}/{sender.id}/accept")).status_code == 404
    log_in(target)
    assert await friend_tags(client) == []
    assert await request_tags(client) == ["sender"]


async def test_accepting_with_no_request_is_not_found(client, log_in, make_user):
    other = await make_user("other")
    log_in(await make_user("viewer"))
    assert (await client.post(f"{REQUESTS}/{other.id}/accept")).status_code == 404
    assert await friend_tags(client) == []


async def test_declining_leaves_no_friendship(client, log_in, make_user):
    sender, target = await make_user("sender"), await make_user("target")
    log_in(sender)
    await client.put(f"{REQUESTS}/{target.id}")
    log_in(target)
    assert (await client.delete(f"{REQUESTS}/{sender.id}")).status_code == 204
    assert await request_tags(client) == [] and await friend_tags(client) == []
    log_in(sender)
    assert await request_tags(client, "outgoing") == [] and await friend_tags(client) == []
    # They can ask again later.
    assert (await client.put(f"{REQUESTS}/{target.id}")).json()["friend_request"] == "sent"


async def test_sender_can_withdraw(client, log_in, make_user):
    sender, target = await make_user("sender"), await make_user("target")
    log_in(sender)
    await client.put(f"{REQUESTS}/{target.id}")
    assert (await client.delete(f"{REQUESTS}/{target.id}")).status_code == 204
    assert await request_tags(client, "outgoing") == []
    log_in(target)
    assert await request_tags(client) == []
    assert (await client.post(f"{REQUESTS}/{sender.id}/accept")).status_code == 404


async def test_removing_a_missing_request_is_a_no_op(client, log_in, make_user):
    other = await make_user("other")
    log_in(await make_user("viewer"))
    assert (await client.delete(f"{REQUESTS}/{other.id}")).status_code == 204


async def test_outsiders_cant_touch_a_request(client, log_in, make_user):
    sender, target = await make_user("sender"), await make_user("target")
    log_in(sender)
    await client.put(f"{REQUESTS}/{target.id}")
    log_in(await make_user("intruder"))
    assert (await client.delete(f"{REQUESTS}/{sender.id}")).status_code == 204
    assert (await client.delete(f"{REQUESTS}/{target.id}")).status_code == 204
    log_in(target)
    assert await request_tags(client) == ["sender"]


# Several friends at once

async def test_a_player_can_have_many_friends_and_requests_at_once(client, log_in, make_user):
    viewer = await make_user("viewer")
    hens = [await make_user(f"hen_{i}") for i in range(5)]
    for hen in hens[:3]:
        await befriend(client, log_in, viewer, hen)
    log_in(viewer)
    await client.put(f"{REQUESTS}/{hens[3].id}")
    log_in(hens[4])
    await client.put(f"{REQUESTS}/{viewer.id}")
    log_in(viewer)
    assert await friend_tags(client) == ["hen_0", "hen_1", "hen_2"]
    assert await request_tags(client, "outgoing") == ["hen_3"]
    assert await request_tags(client, "incoming") == ["hen_4"]
    # Each friend still has their own list, and ending one friendship leaves the others.
    assert (await client.delete(f"{FRIENDS}/{hens[1].id}")).status_code == 204
    assert await friend_tags(client) == ["hen_0", "hen_2"]
    log_in(hens[0])
    assert await friend_tags(client) == ["viewer"]


async def test_two_players_sharing_a_friend(client, log_in, make_user):
    hub, left, right = await make_user("hub"), await make_user("left"), await make_user("right")
    await befriend(client, log_in, left, hub)
    await befriend(client, log_in, right, hub)
    assert await friend_tags(client) == ["left", "right"]
    log_in(left)
    assert await friend_tags(client) == ["hub"]


# Removing

async def test_removing_a_friend_ends_it_for_both(client, log_in, make_user, db_session):
    first, second = await make_user("first"), await make_user("second")
    await befriend(client, log_in, first, second)
    assert (await client.delete(f"{FRIENDS}/{first.id}")).status_code == 204
    assert await friend_tags(client) == []
    log_in(first)
    assert await friend_tags(client) == []
    assert await db_session.scalar(select(func.count()).select_from(Friendship)) == 0


async def test_removing_a_non_friend_is_a_no_op(client, log_in, make_user):
    target = await make_user("Rooster_42")
    log_in(await make_user("viewer"))
    assert (await client.delete(f"{FRIENDS}/{target.id}")).status_code == 204


async def test_removing_only_touches_own_friendships(client, log_in, make_user):
    first, second = await make_user("first"), await make_user("second")
    await befriend(client, log_in, first, second)
    log_in(await make_user("intruder"))
    assert (await client.delete(f"{FRIENDS}/{first.id}")).status_code == 204
    log_in(first)
    assert await friend_tags(client) == ["second"]


async def test_friendships_are_stored_both_ways(client, log_in, make_user, db_session):
    first, second = await make_user("first"), await make_user("second")
    await befriend(client, log_in, first, second)
    rows = (await db_session.execute(select(Friendship.user_id, Friendship.friend_id))).all()
    assert set(rows) == {(first.id, second.id), (second.id, first.id)}


# Lists

async def test_lists_return_only_public_fields(client, log_in, make_user, db_session):
    target = await make_user("Rooster_42")
    target.email = "secret@example.com"
    await db_session.commit()
    viewer = await make_user("viewer")
    log_in(viewer)
    await client.put(f"{REQUESTS}/{target.id}")
    public = {"id": str(target.id), "tag": "Rooster_42", "username": None, "avatar_url": None}
    assert (await client.get(REQUESTS, params={"direction": "outgoing"})).json() == {"items": [public], "next_offset": None}
    log_in(target)
    await client.post(f"{REQUESTS}/{viewer.id}/accept")
    log_in(viewer)
    assert (await client.get(FRIENDS)).json() == {"items": [public], "next_offset": None}


async def test_friends_are_ordered_by_tag_ignoring_case(client, log_in, make_user):
    viewer = await make_user("viewer")
    for tag in ["charlie", "Alpha", "bravo"]:
        await befriend(client, log_in, viewer, await make_user(tag))
    log_in(viewer)
    assert await friend_tags(client) == ["Alpha", "bravo", "charlie"]


async def test_friends_and_requests_paginate(client, log_in, make_user):
    viewer = await make_user("viewer")
    hens = [await make_user(f"hen_{i}") for i in range(3)]
    for hen in hens:
        await befriend(client, log_in, viewer, hen)
    log_in(viewer)
    first = (await client.get(FRIENDS, params={"limit": 2})).json()
    assert [item["tag"] for item in first["items"]] == ["hen_0", "hen_1"] and first["next_offset"] == 2
    last = (await client.get(FRIENDS, params={"limit": 2, "offset": 2})).json()
    assert [item["tag"] for item in last["items"]] == ["hen_2"] and last["next_offset"] is None
    senders = [await make_user(f"ask_{i}") for i in range(3)]
    for sender in senders:
        log_in(sender)
        await client.put(f"{REQUESTS}/{viewer.id}")
    log_in(viewer)
    page = (await client.get(REQUESTS, params={"limit": 2})).json()
    assert len(page["items"]) == 2 and page["next_offset"] == 2
    rest = (await client.get(REQUESTS, params={"limit": 2, "offset": 2})).json()
    assert len(rest["items"]) == 1 and rest["next_offset"] is None
    all_tags = {item["tag"] for item in page["items"] + rest["items"]}
    assert all_tags == {"ask_0", "ask_1", "ask_2"}


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}])
@pytest.mark.parametrize("path", [FRIENDS, REQUESTS])
async def test_lists_reject_invalid_params(client, log_in, make_user, path, params):
    log_in(await make_user("viewer"))
    assert (await client.get(path, params=params)).status_code == 422


async def test_requests_reject_an_unknown_direction(client, log_in, make_user):
    log_in(await make_user("viewer"))
    assert (await client.get(REQUESTS, params={"direction": "sideways"})).status_code == 422


@pytest.mark.parametrize(("method", "path"), [
    ("GET", FRIENDS), ("GET", REQUESTS), ("PUT", f"{REQUESTS}/{uuid4()}"),
    ("POST", f"{REQUESTS}/{uuid4()}/accept"), ("DELETE", f"{REQUESTS}/{uuid4()}"), ("DELETE", f"{FRIENDS}/{uuid4()}"),
])
async def test_routes_require_auth(client, method, path):
    assert (await client.request(method, path)).status_code == 401


async def test_lists_show_only_the_callers_relationships(client, log_in, make_user):
    first, second = await make_user("first"), await make_user("second")
    await befriend(client, log_in, first, second)
    other = await make_user("other")
    log_in(first)
    await client.put(f"{REQUESTS}/{other.id}")
    log_in(await make_user("viewer"))
    assert await friend_tags(client) == []
    assert await request_tags(client, "incoming") == [] and await request_tags(client, "outgoing") == []


async def test_deleted_players_leave_friends_and_requests(client, log_in, make_user, db_session):
    viewer, friend, asker, asked = [await make_user(tag) for tag in ("viewer", "friend", "asker", "asked")]
    await befriend(client, log_in, viewer, friend)
    log_in(asker)
    await client.put(f"{REQUESTS}/{viewer.id}")
    log_in(viewer)
    await client.put(f"{REQUESTS}/{asked.id}")
    for gone in (friend, asker, asked):
        await db_session.delete(gone)
    await db_session.commit()
    assert await friend_tags(client) == []
    assert await request_tags(client, "incoming") == [] and await request_tags(client, "outgoing") == []


# Profiles

async def test_profile_shows_how_the_player_relates_to_the_caller(client, log_in, make_user):
    target, viewer = await make_user("Rooster_42"), await make_user("viewer")
    log_in(viewer)
    assert relation((await client.get(PROFILE + "Rooster_42")).json()) == (False, None)
    await client.put(f"{REQUESTS}/{target.id}")
    assert relation((await client.get(PROFILE + "Rooster_42")).json()) == (False, "sent")
    # Another viewer sees their own relationship, not the first viewer's.
    log_in(await make_user("other"))
    assert relation((await client.get(PROFILE + "Rooster_42")).json()) == (False, None)
    log_in(target)
    assert relation((await client.get(PROFILE + "viewer")).json()) == (False, "received")
    await client.post(f"{REQUESTS}/{viewer.id}/accept")
    assert relation((await client.get(PROFILE + "viewer")).json()) == (True, None)
    log_in(viewer)
    assert relation((await client.get(PROFILE + "Rooster_42")).json()) == (True, None)


# Concurrency: separate connections, so the database really decides the order.

async def test_requesting_each_other_at_once_makes_friends(db_engine):
    async def service_call(user: User, other: User):
        async with AsyncSession(db_engine, expire_on_commit=False) as session:
            caller = await session.get(User, user.id)
            return await FriendService(session).send_request(caller, other.id)

    async with AsyncSession(db_engine, expire_on_commit=False) as session:
        pairs = [(User(google_sub=f"race-{uuid4()}", tag=f"race_a{i}_{uuid4().hex[:6]}"),
                  User(google_sub=f"race-{uuid4()}", tag=f"race_b{i}_{uuid4().hex[:6]}")) for i in range(10)]
        session.add_all(user for pair in pairs for user in pair)
        await session.commit()
    ids = [user.id for pair in pairs for user in pair]
    try:
        for first, second in pairs:
            await asyncio.gather(service_call(first, second), service_call(second, first))
        async with AsyncSession(db_engine) as session:
            pending = await session.scalar(select(func.count()).select_from(FriendRequest).where(FriendRequest.sender_id.in_(ids)))
            rows = await session.scalar(select(func.count()).select_from(Friendship).where(Friendship.user_id.in_(ids)))
        assert pending == 0
        assert rows == 2 * len(pairs)
    finally:
        async with AsyncSession(db_engine) as session:
            await session.execute(delete(User).where(User.id.in_(ids)))
            await session.commit()


# Rate limits

async def test_friend_changes_share_a_rate_limit(client, log_in, make_user):
    target = await make_user("Rooster_42")
    log_in(await make_user("viewer"))
    actions = [client.put, client.delete]
    statuses = [(await actions[i % 2](f"{REQUESTS}/{target.id}")).status_code for i in range(10)]
    assert statuses == [200, 204] * 5
    assert (await client.delete(f"{FRIENDS}/{target.id}")).status_code == 429
    assert (await client.post(f"{REQUESTS}/{target.id}/accept")).status_code == 429


@pytest.mark.parametrize("path", [FRIENDS, REQUESTS])
async def test_lists_are_rate_limited(client, log_in, make_user, path):
    log_in(await make_user("viewer"))
    statuses = [(await client.get(path)).status_code for _ in range(21)]
    assert statuses == [200] * 20 + [429]
