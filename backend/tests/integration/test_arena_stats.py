from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.services.rewards import MatchReport, record_match

URL = "/v1/users/me/arena-stats"


async def test_arena_stats_requires_auth(client):
    assert (await client.get(URL)).status_code == 401


async def test_arena_stats_empty(client, log_in, make_user):
    log_in(await make_user())  # A tag isn't needed to read your own stats.
    response = await client.get(URL)
    assert response.status_code == 200
    assert response.json() == dict(points=0, debates_played=0, wins=0, win_rate=None, recent_form=[])


async def test_arena_stats_results_and_user_isolation(client, log_in, make_user, db_session):
    user, other, stranger = [await make_user(tag) for tag in ("player", "opponent", "stranger")]
    now = datetime.now(UTC)
    # Alternate sides, include forfeit wins/losses, and put a void after all decided matches.
    outcomes = [("completed", "pro"), ("forfeited", "con"), ("completed", "con"),
                ("completed", "pro"), ("forfeited", "con"), ("completed", "con"),
                ("voided", None)]
    for i, (status, winner) in enumerate(outcomes):
        await record_match(db_session, MatchReport(
            match_id=uuid4(), model_id=None, topic_id=None, challenge_day=None,
            sides={user.id: "pro" if i % 2 == 0 else "con", other.id: "con" if i % 2 == 0 else "pro"},
            result={"status": status, "winner": winner, "end_reason": "judged" if status == "completed" else "no_prompt"},
            ended_at=now + timedelta(seconds=i),
        ))
    log_in(user)
    response = await client.get(URL)
    assert response.status_code == 200
    assert response.json() == dict(points=user.points, debates_played=6, wins=3,
                                   win_rate=50, recent_form=["W", "L", "L", "L", "W"])
    log_in(stranger)
    assert (await client.get(URL)).json() == dict(points=0, debates_played=0, wins=0, win_rate=None, recent_form=[])
    # Query parameters cannot select someone else's data.
    assert (await client.get(URL, params={"user_id": str(user.id)})).json()["debates_played"] == 0
