import pytest

from app.db.seed_ladders import cloud_ladder_slug, provision_ladders
from app.models import Ladder, Rating, User
from sqlalchemy import select

URL = "/v1/ladders"


@pytest.fixture
async def ladders(make_model, db_session):
    model, other, inactive = [await make_model() for _ in range(3)]
    await provision_ladders(db_session)
    inactive.is_active = False  # delisting leaves the ladder and its ratings in place
    await db_session.commit()
    slugs = [cloud_ladder_slug(row.id) for row in (model, other, inactive)] + ["byom-arena"]
    rows = (await db_session.scalars(select(Ladder).where(Ladder.slug.in_(slugs)))).all()
    by_slug = {row.slug: row for row in rows}
    return tuple(by_slug[slug] for slug in slugs)


async def test_catalog_and_standings_require_auth(client):
    assert (await client.get(URL)).status_code == 401
    assert (await client.get(f"{URL}/byom-arena/leaderboard")).status_code == 401


async def test_catalog_only_lists_active_ladders(client, log_in, make_user, ladders, db_session):
    cloud, other, delisted, byom = ladders
    other.is_active = False
    await db_session.commit()
    log_in(await make_user())
    response = await client.get(URL)
    assert response.status_code == 200
    assert response.json() == [
        {"slug": cloud.slug, "display_name": "Test model", "kind": "cloud"},
        {"slug": byom.slug, "display_name": byom.display_name, "kind": "byom"},
    ]
    for slug in (other.slug, delisted.slug, "missing"):
        response = await client.get(f"{URL}/{slug}/leaderboard")
        assert response.status_code == 404
        assert response.json()["code"] == "NOT_FOUND"


async def test_standings_paginate_only_the_top_50_rated_players(client, log_in, make_user, ladders, db_session):
    cloud, other, _, byom = ladders
    caller = await make_user("viewer")
    players = [User(tag=f"player{i:02}", email=f"private{i}@example.invalid") for i in range(52)]
    untagged = User()
    db_session.add_all([*players, untagged])
    await db_session.flush()
    db_session.add_all([
        *(Rating(user_id=user.id, ladder_id=cloud.id, elo=1500 - i // 3, games_played=1)
          for i, user in reversed(list(enumerate(players)))),
        Rating(user_id=caller.id, ladder_id=cloud.id, elo=1700, games_played=0),
        Rating(user_id=untagged.id, ladder_id=cloud.id, elo=1800, games_played=1),
        Rating(user_id=caller.id, ladder_id=byom.id, elo=1234, games_played=1),
        Rating(user_id=players[0].id, ladder_id=byom.id, elo=1100, games_played=1),
    ])
    await db_session.commit()
    log_in(caller)

    url = f"{URL}/{cloud.slug}/leaderboard"
    first = await client.get(url)
    second = await client.get(url, params={"offset": 20, "limit": 20})
    third = await client.get(url, params={"offset": 40, "limit": 20})
    assert [response.status_code for response in (first, second, third)] == [200, 200, 200]
    assert [len(response.json()) for response in (first, second, third)] == [20, 20, 10]
    entries = first.json() + second.json() + third.json()
    assert [entry["rank"] for entry in entries] == list(range(1, 51))
    assert [entry["user"]["tag"] for entry in entries] == [user.tag for user in players[:50]]
    assert [entry["rating"]["elo"] for entry in entries] == [1500 - i // 3 for i in range(50)]
    assert set(entries[0]["user"]) == {"id", "tag", "username", "avatar_url"}
    assert entries[0]["rating"]["ladder"] == cloud.slug
    assert (await client.get(url, params={"offset": 50})).json() == []
    assert (await client.get(f"{URL}/{other.slug}/leaderboard")).json() == []

    byom_entries = (await client.get(f"{URL}/{byom.slug}/leaderboard")).json()
    assert [(entry["user"]["tag"], entry["rating"]["elo"]) for entry in byom_entries] == [
        ("viewer", 1234), ("player00", 1100),
    ]


async def test_standings_validate_page_and_rate_limit(client, log_in, make_user, ladders):
    log_in(await make_user())
    url = f"{URL}/{ladders[-1].slug}/leaderboard"
    for params in ({"limit": 0}, {"limit": 51}, {"offset": -1}):
        assert (await client.get(url, params=params)).status_code == 422

    # Rate limit state is shared across pages, and refills slowly.
    for _ in range(21):
        response = await client.get(url)
    assert response.status_code == 429
    assert response.json()["code"] == "RATE_LIMITED"
    assert "Retry-After" in response.headers
