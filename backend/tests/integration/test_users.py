import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import set_committed_value

from app.config import settings
from app.models import User
from app.schemas import GoogleIdentity
from app.services.exceptions import UsernameAlreadySetError
from app.services.user import UserService

PATCH_ME = "/api/v1/users/me"
AVAILABILITY = "/api/v1/users/username-availability"


async def count_with_username(db_session, username: str) -> int:
    statement = select(func.count()).where(func.lower(User.username) == username.lower())
    return await db_session.scalar(statement)


# PATCH /api/v1/users/me

async def test_new_user_has_no_tag(client, log_in, make_user):
    user = await make_user()
    log_in(user)
    response = await client.get("/auth/me")
    assert response.status_code == 200
    assert response.json()["username"] is None


async def test_set_tag(client, log_in, make_user, db_session):
    user = await make_user()
    log_in(user)
    response = await client.patch(PATCH_ME, json={"username": "Rooster_42"})
    assert response.status_code == 200
    assert response.json()["username"] == "Rooster_42"
    assert response.json()["id"] == str(user.id)
    await db_session.refresh(user)
    assert user.username == "Rooster_42"


async def test_set_tag_requires_auth(client):
    response = await client.patch(PATCH_ME, json={"username": "Rooster_42"})
    assert response.status_code == 401


@pytest.mark.parametrize("username", ["ab", "a" * 25, "has space", "dash-ed", "émile"])
async def test_invalid_format_is_rejected(client, log_in, make_user, username):
    log_in(await make_user())
    response = await client.patch(PATCH_ME, json={"username": username})
    assert response.status_code == 422
    assert response.json()["code"] == "USERNAME_INVALID"


@pytest.mark.parametrize("body", [{}, {"username": None}, {"username": 123}, {"username": "x" * 65}])
async def test_malformed_body_is_rejected(client, log_in, make_user, body):
    log_in(await make_user())
    response = await client.patch(PATCH_ME, json=body)
    assert response.status_code == 422


async def test_profane_tag_is_rejected(client, log_in, make_user):
    user = await make_user()
    log_in(user)
    response = await client.patch(PATCH_ME, json={"username": "big_sh1t"})
    assert response.status_code == 422
    assert response.json()["code"] == "USERNAME_NOT_ALLOWED"
    assert user.username is None


@pytest.mark.parametrize("attempt", ["taken_tag", "TAKEN_TAG", "Taken_Tag"])
async def test_taken_tag_is_rejected_case_insensitively(client, log_in, make_user, db_session, attempt):
    await make_user("taken_tag")
    log_in(await make_user())
    response = await client.patch(PATCH_ME, json={"username": attempt})
    assert response.status_code == 409
    assert response.json() == {"code": "USERNAME_TAKEN", "detail": "That tag is already taken."}
    assert await count_with_username(db_session, "taken_tag") == 1


@pytest.mark.parametrize("attempt", ["new_tag", "first_tag", "FIRST_TAG"])
async def test_tag_cannot_be_changed(client, log_in, make_user, db_session, attempt):
    user = await make_user()
    log_in(user)
    assert (await client.patch(PATCH_ME, json={"username": "first_tag"})).status_code == 200

    response = await client.patch(PATCH_ME, json={"username": attempt})
    assert response.status_code == 409
    assert response.json()["code"] == "USERNAME_ALREADY_SET"
    await db_session.refresh(user)
    assert user.username == "first_tag"


async def test_already_set_wins_over_invalid_input(client, log_in, make_user):
    log_in(await make_user("first_tag"))
    response = await client.patch(PATCH_ME, json={"username": "no"})
    assert response.status_code == 409
    assert response.json()["code"] == "USERNAME_ALREADY_SET"


async def test_concurrent_claims_set_only_one_tag(db_session, make_user):
    """A stale user object (loaded before another request set the tag) still can't overwrite it."""
    user = await make_user()
    await UserService(db_session).claim_username(user, "winner")
    set_committed_value(user, "username", None)  # stale copy, not a pending write
    with pytest.raises(UsernameAlreadySetError):
        await UserService(db_session).claim_username(user, "loser")
    await db_session.refresh(user)
    assert user.username == "winner"


async def test_sign_in_does_not_change_tag(db_session, make_user):
    user = await make_user("kept_tag")
    identity = GoogleIdentity(sub=user.google_sub, email="new@example.com", email_verified=True, name="Other Name")
    signed_in = await UserService(db_session).sign_in_with_google(identity)
    assert signed_in.id == user.id
    assert signed_in.username == "kept_tag"


async def test_database_enforces_case_insensitive_uniqueness(db_session, make_user):
    await make_user("Unique_Tag")
    with pytest.raises(IntegrityError):
        await make_user("unique_tag")


# GET /api/v1/users/username-availability

async def test_availability_requires_auth(client):
    response = await client.get(AVAILABILITY, params={"username": "anything"})
    assert response.status_code == 401


@pytest.mark.parametrize(
    ("username", "code"),
    [("free_tag", None), ("TAKEN_tag", "USERNAME_TAKEN"), ("ab", "USERNAME_INVALID"),
     ("bad space", "USERNAME_INVALID"), ("fuckyou", "USERNAME_NOT_ALLOWED")],
)
async def test_availability(client, log_in, make_user, username, code):
    await make_user("taken_tag")
    log_in(await make_user())
    response = await client.get(AVAILABILITY, params={"username": username})
    assert response.status_code == 200
    body = response.json()
    assert body["available"] is (code is None)
    assert body["code"] == code
    assert (body["detail"] is None) is (code is None)


async def test_availability_rejects_oversized_query(client, log_in, make_user):
    log_in(await make_user())
    response = await client.get(AVAILABILITY, params={"username": "x" * 65})
    assert response.status_code == 422


# Matchmaking requires a tag

async def test_queue_requires_tag(client, log_in, make_user):
    user = await make_user()
    log_in(user)
    response = await client.post("/match/queue")
    assert response.status_code == 403
    assert response.json()["code"] == "USERNAME_REQUIRED"
    assert (await client.get("/match/status")).json() == {"status": "none"}


async def test_queue_allowed_with_tag(client, log_in, make_user):
    log_in(await make_user("queuer"))
    response = await client.post("/match/queue")
    assert response.status_code == 202
    assert response.json() == {"status": "queued"}


async def test_patch_is_allowed_by_cors(client):
    response = await client.options(PATCH_ME, headers={
        "Origin": settings.frontend_url,
        "Access-Control-Request-Method": "PATCH",
    })
    assert response.status_code == 200
    assert "PATCH" in response.headers["access-control-allow-methods"]
