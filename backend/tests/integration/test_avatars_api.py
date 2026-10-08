import io
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from PIL import Image
from sqlalchemy import select

from app.models import Avatar, User

UPLOAD = "/v1/users/me/avatar"


def png(color="red", size=(300, 200)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


async def test_upload_sets_versioned_url_and_serves_webp(client, log_in, make_user):
    user = await make_user("Rooster_42")
    log_in(user)
    response = await client.put(UPLOAD, content=png(), headers={"Content-Type": "image/png"})
    assert response.status_code == 200
    url = response.json()["avatar_url"]
    assert url.startswith(f"/v1/users/{user.id}/avatar?v=")
    image = await client.get(url)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/webp"
    assert "immutable" in image.headers["cache-control"]
    # A new upload gets a new URL, so cached copies never go stale.
    again = (await client.put(UPLOAD, content=png("blue"), headers={"Content-Type": "image/png"})).json()["avatar_url"]
    assert again != url


async def test_profile_shows_uploaded_picture(client, log_in, make_user):
    owner = await make_user("Rooster_42")
    log_in(owner)
    url = (await client.put(UPLOAD, content=png())).json()["avatar_url"]
    log_in(await make_user("viewer"))
    assert (await client.get("/v1/users/by-tag/rooster_42")).json()["avatar_url"] == url
    assert (await client.get(url)).status_code == 200


async def test_invalid_upload_is_rejected_and_nothing_stored(client, log_in, make_user, db_session):
    user = await make_user("Rooster_42")
    log_in(user)
    response = await client.put(UPLOAD, content=b"<svg onload=alert(1)>", headers={"Content-Type": "image/png"})
    assert response.status_code == 422
    assert response.json()["code"] == "AVATAR_INVALID"
    assert await db_session.get(Avatar, user.id) is None


async def test_oversized_upload_is_rejected(client, log_in, make_user):
    log_in(await make_user("Rooster_42"))
    response = await client.put(UPLOAD, content=b"\0" * (2 * 1024 * 1024 + 1))
    assert response.status_code == 422


async def test_remove_picture(client, log_in, make_user, db_session):
    user = await make_user("Rooster_42")
    log_in(user)
    url = (await client.put(UPLOAD, content=png())).json()["avatar_url"]
    response = await client.delete(UPLOAD)
    assert response.status_code == 200
    assert response.json()["avatar_url"] is None
    assert (await client.get(url)).status_code == 404


async def test_google_sign_in_keeps_uploaded_picture(client, log_in, db_session):
    google = SimpleNamespace(authorize_access_token=AsyncMock(return_value={
        "userinfo": {"sub": "google-9", "email_verified": True, "picture": "https://lh3.googleusercontent.com/a/pic"},
    }))
    with patch("app.api.auth.oauth") as oauth:
        oauth.create_client.return_value = google
        await client.get("/auth/google/callback")
        user = await db_session.scalar(select(User).where(User.google_sub == "google-9"))
        assert user.avatar_url == "https://lh3.googleusercontent.com/a/pic"
        log_in(user)
        uploaded = (await client.put(UPLOAD, content=png())).json()["avatar_url"]
        await client.get("/auth/google/callback")
    await db_session.refresh(user)
    assert user.avatar_url == uploaded


async def test_avatar_routes_require_auth(client, make_user):
    user = await make_user("Rooster_42")
    assert (await client.put(UPLOAD, content=png())).status_code == 401
    assert (await client.get(f"/v1/users/{user.id}/avatar")).status_code == 401
