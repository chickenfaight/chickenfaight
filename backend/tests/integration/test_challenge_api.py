from datetime import UTC, datetime

from app.main import app
from app.models import ChallengeCompletion
from app.services.challenge import CHALLENGE_POINTS, today, twist_for


async def test_today_describes_the_shared_challenge(client, log_in, make_user):
    log_in(await make_user("Rooster_42"))
    body = (await client.get("/v1/challenge/today")).json()
    day = today()
    assert body["day"] == day.isoformat()
    assert body["twist"]["title"] == twist_for(day).title
    assert body["reward_points"] == CHALLENGE_POINTS
    assert body["completed"] is False
    assert datetime.fromisoformat(body["resets_at"]) > datetime.now(UTC)


async def test_completed_challenge_shows_and_blocks_requeueing(client, log_in, make_user, make_model, db_session):
    user = await make_user("Rooster_42")
    log_in(user)
    db_session.add(ChallengeCompletion(user_id=user.id, day=today()))
    await db_session.commit()
    assert (await client.get("/v1/challenge/today")).json()["completed"] is True
    model = await make_model()
    response = await client.post("/v1/match/queue", json={"model_id": str(model.id), "daily": True})
    assert response.status_code == 409
    assert response.json()["code"] == "CHALLENGE_ALREADY_COMPLETED"
    # Regular matches are still fine.
    assert (await client.post("/v1/match/queue", json={"model_id": str(model.id)})).status_code == 202


async def test_daily_queue_is_separate_from_regular(client, log_in, make_user, make_model):
    user = await make_user("Rooster_42")
    log_in(user)
    model = await make_model()
    await client.post("/v1/match/queue", json={"model_id": str(model.id), "daily": True})
    assert app.state.matchmaker.queued_users[user.id] == (model.id, today())


async def test_profile_shows_points_streak_and_rank(client, log_in, make_user, db_session):
    target = await make_user("Rooster_42")
    target.points, target.streak, target.last_played_at = 120, 3, datetime.now(UTC)
    await db_session.commit()
    log_in(await make_user("viewer"))
    body = (await client.get("/v1/users/by-tag/rooster_42")).json()
    assert (body["points"], body["streak"], body["rank"]) == (120, 3, 1)
