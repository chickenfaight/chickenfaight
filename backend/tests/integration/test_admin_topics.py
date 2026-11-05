"""Admin topic upload: only tags in ADMIN_TAGS may list or add topics (PROTOCOL.md, "REST — admin")."""
import pytest
from sqlalchemy import func, select

from app.auth import admins
from app.models import Topic
from app.services.topics import MAX_UPLOAD_TOPICS

ADMIN = "Topic_Admin"


@pytest.fixture(autouse=True)
def admin_tags(monkeypatch):
    # Tests don't depend on who the real admins are.
    monkeypatch.setattr(admins, "_ADMIN_TAGS_LOWER", frozenset({ADMIN.lower()}))


async def topic_count(db_session) -> int:
    return await db_session.scalar(select(func.count()).select_from(Topic))


async def test_admin_uploads_topics_and_duplicates_are_skipped(client, log_in, make_user, db_session):
    log_in(await make_user(ADMIN))
    before = await topic_count(db_session)
    text = (
        "# a comment\n"
        "\n"
        "Food | Is soup a drink? | Soup is a drink. | Soup is food.\n"
        " Food |Is soup a drink?| Soup is a drink. | Soup is food. \n"  # same after trimming
        "Tech | Tabs or spaces? | Tabs. | Spaces.\n"
    )
    response = await client.post("/v1/admin/topics", json={"text": text})
    assert response.status_code == 200
    assert response.json() == {"added": 2, "skipped": 1}
    assert await topic_count(db_session) == before + 2

    again = await client.post("/v1/admin/topics", json={"text": text})
    assert again.json() == {"added": 0, "skipped": 3}
    assert await topic_count(db_session) == before + 2


async def test_upload_can_add_inactive_topics_and_list_shows_newest(client, log_in, make_user):
    log_in(await make_user(ADMIN))
    response = await client.post(
        "/v1/admin/topics",
        json={"text": "Life | Naps? | Naps are good. | Naps are bad.", "is_active": False},
    )
    assert response.json() == {"added": 1, "skipped": 0}
    page = (await client.get("/v1/admin/topics")).json()
    assert page["total"] >= 1
    newest = page["topics"][0]
    assert (newest["category"], newest["topic"], newest["is_active"]) == ("Life", "Naps?", False)
    assert set(newest) == {"id", "category", "topic", "pro_position", "con_position", "is_active", "created_at"}


async def test_admin_check_ignores_tag_case(client, log_in, make_user):
    log_in(await make_user(ADMIN.upper()))
    assert (await client.get("/v1/admin/topics")).status_code == 200


@pytest.mark.parametrize("tag", [None, "Rooster_42"])
async def test_non_admins_are_forbidden(client, log_in, make_user, db_session, tag):
    user = await make_user(tag)
    log_in(user)
    before = await topic_count(db_session)
    for response in (
        await client.get("/v1/admin/topics"),
        await client.post("/v1/admin/topics", json={"text": "A | B | C | D"}),
        # Forbidden before the body is even looked at.
        await client.post("/v1/admin/topics", json={}),
    ):
        assert response.status_code == 403
        assert response.json()["code"] == "FORBIDDEN"
    assert await topic_count(db_session) == before


async def test_auth_me_reports_admin(client, log_in, make_user):
    log_in(await make_user(ADMIN))
    assert (await client.get("/auth/me")).json()["is_admin"] is True
    log_in(await make_user("Rooster_42"))
    assert (await client.get("/auth/me")).json()["is_admin"] is False


@pytest.mark.parametrize(("text", "detail"), [
    ("Food | Fine | Pro | Con\nonly | three | fields", "Line 2:"),
    ("Food | Topic | | Con", "Line 1:"),
    ("Food | " + "x" * 256 + " | Pro | Con", "Line 1:"),
    ("# only a comment\n\n", "No topics"),
])
async def test_invalid_lists_add_nothing(client, log_in, make_user, db_session, text, detail):
    log_in(await make_user(ADMIN))
    before = await topic_count(db_session)
    response = await client.post("/v1/admin/topics", json={"text": text})
    assert response.status_code == 422
    assert response.json()["code"] == "TOPICS_INVALID"
    assert response.json()["detail"].startswith(detail)
    assert await topic_count(db_session) == before


async def test_too_many_topics_are_rejected(client, log_in, make_user):
    log_in(await make_user(ADMIN))
    text = "\n".join(f"C | Topic {n} | Pro | Con" for n in range(MAX_UPLOAD_TOPICS + 1))
    response = await client.post("/v1/admin/topics", json={"text": text})
    assert response.status_code == 422
    assert response.json()["code"] == "TOPICS_INVALID"


@pytest.mark.parametrize("body", [{}, {"text": ""}, {"text": "x" * 200_001}, {"text": "A|B|C|D", "is_active": "maybe"}])
async def test_malformed_bodies_are_422(client, log_in, make_user, body):
    log_in(await make_user(ADMIN))
    assert (await client.post("/v1/admin/topics", json=body)).status_code == 422
