from uuid import uuid4

from sqlalchemy import func, select

from app.main import app
from app.models import Friendship, User, UserSession
from app.services.auth_session import SessionService

from test_auth_sessions import use_token

DELETE_ME = "/v1/users/me"


async def test_delete_account_removes_user_and_signs_out(client, make_user, db_session):
    user = await make_user("Rooster_42")
    use_token(client, await SessionService(db_session).start(user))
    assert (await client.delete(DELETE_ME)).status_code == 204
    assert await db_session.get(User, user.id) is None
    assert (await client.get("/auth/me")).status_code == 401


async def test_deletion_ends_every_session(client, make_user, db_session):
    user = await make_user("Rooster_42")
    laptop = await SessionService(db_session).start(user)
    phone = await SessionService(db_session).start(user)
    use_token(client, laptop)
    await client.delete(DELETE_ME)
    use_token(client, phone)
    assert (await client.get("/auth/me")).status_code == 401
    count = await db_session.scalar(select(func.count()).select_from(UserSession).where(UserSession.user_id == user.id))
    assert count == 0


async def test_deleted_user_vanishes_from_friends_profiles_and_search(client, log_in, make_user, db_session):
    gone = await make_user("Rooster_42")
    friend = await make_user("friendly_hen")
    log_in(friend)
    await client.put(f"/v1/friends/{gone.id}")
    log_in(gone)
    await client.put(f"/v1/friends/{friend.id}")
    assert (await client.delete(DELETE_ME)).status_code == 204
    log_in(friend)
    assert (await client.get("/v1/friends")).json()["items"] == []
    assert (await client.get("/v1/users/by-tag/Rooster_42")).status_code == 404
    assert (await client.get("/v1/users/search", params={"q": "rooster"})).json()["items"] == []
    remaining = await db_session.scalar(select(func.count()).select_from(Friendship).where(
        (Friendship.user_id == gone.id) | (Friendship.friend_id == gone.id)))
    assert remaining == 0


async def test_deletion_leaves_the_queue(client, log_in, make_user, make_model):
    user = await make_user("Rooster_42")
    log_in(user)
    model = await make_model()
    await client.post("/v1/match/queue", json={"model_id": str(model.id)})
    assert user.id in app.state.matchmaker.queued_users
    await client.delete(DELETE_ME)
    assert user.id not in app.state.matchmaker.queued_users


async def test_deletion_forfeits_a_live_match(client, log_in, make_user):
    user = await make_user("Rooster_42")
    log_in(user)
    match_id = uuid4()
    resigned = []
    app.state.matchmaker.assignments[user.id] = match_id
    app.state.matchmaker.engines[match_id] = type("Engine", (), {
        "result": None, "resign": lambda self, player: resigned.append(player)})()
    assert (await client.delete(DELETE_ME)).status_code == 204
    assert resigned == [user.id]


async def test_delete_requires_auth(client):
    assert (await client.delete(DELETE_ME)).status_code == 401
