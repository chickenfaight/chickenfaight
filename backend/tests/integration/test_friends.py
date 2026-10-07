from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models import Friendship

FRIENDS = "/v1/friends"
PROFILE = "/v1/users/by-username/"


async def friend_tags(client, **params) -> list[str]:
    response = await client.get(FRIENDS, params=params)
    assert response.status_code == 200
    return [item["username"] for item in response.json()["items"]]


# PUT /v1/friends/{user_id}

async def test_add_friend(client, log_in, make_user):
    target = await make_user("Rooster_42")
    log_in(await make_user("viewer"))
    response = await client.put(f"{FRIENDS}/{target.id}")
    assert response.status_code == 204
    assert await friend_tags(client) == ["Rooster_42"]


async def test_add_many_friends(client, log_in, make_user):
    hens = [await make_user(f"hen_{i}") for i in range(3)]
    log_in(await make_user("viewer"))
    for hen in hens:
        assert (await client.put(f"{FRIENDS}/{hen.id}")).status_code == 204
    assert await friend_tags(client) == ["hen_0", "hen_1", "hen_2"]


async def test_adding_twice_is_idempotent(client, log_in, make_user, db_session):
    target = await make_user("Rooster_42")
    viewer = await make_user("viewer")
    log_in(viewer)
    assert (await client.put(f"{FRIENDS}/{target.id}")).status_code == 204
    assert (await client.put(f"{FRIENDS}/{target.id}")).status_code == 204
    count = await db_session.scalar(select(func.count()).select_from(Friendship).where(Friendship.user_id == viewer.id))
    assert count == 1


async def test_adding_is_one_way(client, log_in, make_user):
    target = await make_user("Rooster_42")
    viewer = await make_user("viewer")
    log_in(viewer)
    await client.put(f"{FRIENDS}/{target.id}")
    log_in(target)
    assert await friend_tags(client) == []


async def test_cannot_add_self(client, log_in, make_user):
    viewer = await make_user("viewer")
    log_in(viewer)
    response = await client.put(f"{FRIENDS}/{viewer.id}")
    assert response.status_code == 422
    assert response.json()["code"] == "FRIEND_SELF"


async def test_add_unknown_user_is_not_found(client, log_in, make_user):
    log_in(await make_user("viewer"))
    response = await client.put(f"{FRIENDS}/{uuid4()}")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


async def test_add_untagged_user_is_not_found(client, log_in, make_user):
    untagged = await make_user()
    log_in(await make_user("viewer"))
    response = await client.put(f"{FRIENDS}/{untagged.id}")
    assert response.status_code == 404


async def test_add_rejects_malformed_id(client, log_in, make_user):
    log_in(await make_user("viewer"))
    assert (await client.put(f"{FRIENDS}/not-a-uuid")).status_code == 422


async def test_add_requires_auth(client, make_user):
    target = await make_user("Rooster_42")
    assert (await client.put(f"{FRIENDS}/{target.id}")).status_code == 401


# DELETE /v1/friends/{user_id}

async def test_remove_friend(client, log_in, make_user):
    target = await make_user("Rooster_42")
    log_in(await make_user("viewer"))
    await client.put(f"{FRIENDS}/{target.id}")
    assert (await client.delete(f"{FRIENDS}/{target.id}")).status_code == 204
    assert await friend_tags(client) == []


async def test_remove_non_friend_is_a_no_op(client, log_in, make_user):
    target = await make_user("Rooster_42")
    log_in(await make_user("viewer"))
    assert (await client.delete(f"{FRIENDS}/{target.id}")).status_code == 204


async def test_remove_only_touches_own_list(client, log_in, make_user):
    target = await make_user("Rooster_42")
    owner = await make_user("owner")
    log_in(owner)
    await client.put(f"{FRIENDS}/{target.id}")
    # Someone else removing the same player only edits their own (empty) list.
    log_in(await make_user("intruder"))
    assert (await client.delete(f"{FRIENDS}/{target.id}")).status_code == 204
    log_in(owner)
    assert await friend_tags(client) == ["Rooster_42"]


async def test_remove_requires_auth(client, make_user):
    target = await make_user("Rooster_42")
    assert (await client.delete(f"{FRIENDS}/{target.id}")).status_code == 401


# GET /v1/friends

async def test_list_returns_only_public_fields(client, log_in, make_user, db_session):
    target = await make_user("Rooster_42")
    target.email = "secret@example.com"
    await db_session.commit()
    log_in(await make_user("viewer"))
    await client.put(f"{FRIENDS}/{target.id}")
    response = await client.get(FRIENDS)
    assert response.json() == {
        "items": [{"id": str(target.id), "username": "Rooster_42", "avatar_url": None}],
        "next_offset": None,
    }


async def test_list_orders_by_tag_ignoring_case(client, log_in, make_user):
    tagged = [await make_user(tag) for tag in ["charlie", "Alpha", "bravo"]]
    log_in(await make_user("viewer"))
    for user in tagged:
        await client.put(f"{FRIENDS}/{user.id}")
    assert await friend_tags(client) == ["Alpha", "bravo", "charlie"]


async def test_list_paginates(client, log_in, make_user):
    hens = [await make_user(f"hen_{i}") for i in range(5)]
    log_in(await make_user("viewer"))
    for hen in hens:
        await client.put(f"{FRIENDS}/{hen.id}")
    first = (await client.get(FRIENDS, params={"limit": 2})).json()
    assert [item["username"] for item in first["items"]] == ["hen_0", "hen_1"]
    assert first["next_offset"] == 2
    last = (await client.get(FRIENDS, params={"limit": 2, "offset": 4})).json()
    assert [item["username"] for item in last["items"]] == ["hen_4"]
    assert last["next_offset"] is None


async def test_list_shows_only_callers_friends(client, log_in, make_user):
    target = await make_user("Rooster_42")
    log_in(await make_user("owner"))
    await client.put(f"{FRIENDS}/{target.id}")
    log_in(await make_user("viewer"))
    assert await friend_tags(client) == []


async def test_deleted_friend_leaves_the_list(client, log_in, make_user, db_session):
    target = await make_user("Rooster_42")
    log_in(await make_user("viewer"))
    await client.put(f"{FRIENDS}/{target.id}")
    await db_session.delete(target)
    await db_session.commit()
    assert await friend_tags(client) == []


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}])
async def test_list_rejects_invalid_params(client, log_in, make_user, params):
    log_in(await make_user("viewer"))
    assert (await client.get(FRIENDS, params=params)).status_code == 422


async def test_list_requires_auth(client):
    assert (await client.get(FRIENDS)).status_code == 401


# is_friend on profiles

async def test_profile_shows_whether_caller_added_player(client, log_in, make_user):
    target = await make_user("Rooster_42")
    log_in(await make_user("viewer"))
    assert (await client.get(PROFILE + "Rooster_42")).json()["is_friend"] is False
    await client.put(f"{FRIENDS}/{target.id}")
    assert (await client.get(PROFILE + "Rooster_42")).json()["is_friend"] is True
    # Another viewer sees their own relationship, not the first viewer's.
    log_in(await make_user("other"))
    assert (await client.get(PROFILE + "Rooster_42")).json()["is_friend"] is False


# Rate limits

async def test_friend_writes_share_a_rate_limit(client, log_in, make_user):
    target = await make_user("Rooster_42")
    log_in(await make_user("viewer"))
    statuses = []
    for i in range(11):
        method = client.put if i % 2 == 0 else client.delete
        statuses.append((await method(f"{FRIENDS}/{target.id}")).status_code)
    assert statuses == [204] * 10 + [429]


async def test_friend_list_is_rate_limited(client, log_in, make_user):
    log_in(await make_user("viewer"))
    statuses = [(await client.get(FRIENDS)).status_code for _ in range(21)]
    assert statuses == [200] * 20 + [429]
