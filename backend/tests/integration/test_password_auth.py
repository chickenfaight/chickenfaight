import pytest
from sqlalchemy import select

from app.auth.passwords import hash_password, verify_password
from app.models import User

SIGNUP = "/auth/signup"
LOGIN = "/auth/login"
ME = "/auth/me"


async def sign_up(client, tag="Rooster_42", password="correct horse", username="Rooster", **extra):
    return await client.post(SIGNUP, json={"tag": tag, "username": username, "password": password, **extra})


# POST /auth/signup

async def test_signup_creates_account_and_signs_in(client, db_session):
    response = await sign_up(client, email="hen@example.com")
    assert response.status_code == 204
    me = (await client.get(ME)).json()
    assert (me["tag"], me["username"]) == ("Rooster_42", "Rooster")
    user = await db_session.scalar(select(User).where(User.tag == "Rooster_42"))
    assert user.google_sub is None


async def test_password_is_stored_only_as_a_salted_hash(client, db_session):
    await sign_up(client, password="correct horse")
    user = await db_session.scalar(select(User).where(User.tag == "Rooster_42"))
    assert "correct horse" not in (user.password_hash + user.password_salt)
    assert verify_password("correct horse", user.password_salt, user.password_hash)
    # Same password, different salt, different hash.
    assert hash_password("correct horse")[1] != user.password_hash


async def test_signup_rejects_taken_tag_ignoring_case(client, make_user):
    await make_user("Rooster_42")
    response = await sign_up(client, tag="rooster_42")
    assert response.status_code == 409
    assert response.json()["code"] == "TAG_TAKEN"


async def test_signup_applies_username_rules(client):
    response = await sign_up(client, username="   ")
    assert response.status_code == 422
    assert response.json()["code"] == "USERNAME_INVALID"


async def test_signup_applies_tag_rules(client):
    response = await sign_up(client, tag="no spaces!")
    assert response.status_code == 422
    assert response.json()["code"] == "TAG_INVALID"


@pytest.mark.parametrize("body", [
    {},
    {"tag": "Rooster_42"},
    {"tag": "Rooster_42", "username": "Rooster", "password": "short"},
    {"tag": "Rooster_42", "username": "Rooster", "password": "x" * 129},
    {"tag": "Rooster_42", "username": "Rooster", "password_hash": "client-hashed"},
    {"tag": "Rooster_42", "password": "correct horse"},  # username is required
])
async def test_signup_rejects_malformed_bodies(client, body):
    assert (await client.post(SIGNUP, json=body)).status_code == 422


async def test_signup_is_rate_limited_per_ip(client):
    statuses = [(await sign_up(client, tag=f"hen_{i}")).status_code for i in range(6)]
    assert statuses == [204] * 5 + [429]


# POST /auth/login

async def test_login_with_correct_password(client):
    await sign_up(client)
    await client.post("/auth/logout")
    assert (await client.get(ME)).status_code == 401
    response = await client.post(LOGIN, json={"tag": "rooster_42", "password": "correct horse"})
    assert response.status_code == 204
    assert (await client.get(ME)).json()["tag"] == "Rooster_42"


@pytest.mark.parametrize(("tag", "password"), [
    ("Rooster_42", "wrong password"),  # wrong password
    ("nobody_here", "correct horse"),  # unknown tag
    ("google_only", "correct horse"),  # account without a password
])
async def test_failed_logins_look_identical(client, make_user, tag, password):
    await make_user("google_only")
    await sign_up(client)
    await client.post("/auth/logout")
    response = await client.post(LOGIN, json={"tag": tag, "password": password})
    assert response.status_code == 401
    assert response.json() == {"code": "INVALID_CREDENTIALS", "detail": "Incorrect tag or password."}
    assert (await client.get(ME)).status_code == 401


async def test_login_is_rate_limited_per_tag(client):
    await sign_up(client)
    statuses = [
        (await client.post(LOGIN, json={"tag": "Rooster_42", "password": "guess"})).status_code
        for _ in range(6)
    ]
    assert statuses == [401] * 5 + [429]


async def test_login_is_rate_limited_per_ip(client):
    statuses = [
        (await client.post(LOGIN, json={"tag": f"tag_{i}", "password": "guess"})).status_code
        for i in range(11)
    ]
    assert statuses == [401] * 10 + [429]
