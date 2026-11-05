"""Match history: what `record_match` saves, and who can read it back."""
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import MatchParticipant, Model, Topic, Turn
from app.services.rewards import MatchReport, record_match

NOON = datetime(2026, 10, 8, 12, 0, tzinfo=UTC)
MATCH = "/v1/matches/"


def history(user) -> str:
    return f"/v1/users/{user.id}/matches"


async def save(session, pro, con, *, status="completed", winner="pro", end_reason="judged", when=NOON, model_id=None,
               topic=None, models=None, arguments=None, truncated=frozenset(), reason="Sharper.", challenge_day=None):
    report = MatchReport(
        match_id=uuid4(), model_id=model_id, topic_id=topic.id if topic else None, challenge_day=challenge_day,
        sides={pro.id: "pro", con.id: "con"},
        result={"status": status, "winner": winner, "end_reason": end_reason, "reason": reason,
                "arguments": arguments if arguments is not None else {"pro": "Pro argument.", "con": "Con argument."}},
        ended_at=when, model_names=models if models is not None else {pro.id: "Test model", con.id: "Test model"},
        truncated=truncated,
    )
    await record_match(session, report)
    return report.match_id


@pytest.fixture
async def topic(db_session):
    row = Topic(topic="Should transit be free?", pro_position="Transit should be free.", con_position="It should not.")
    db_session.add(row)
    await db_session.commit()
    return row


@pytest.fixture
async def players(make_user):
    return await make_user("pro_hen"), await make_user("con_hen")


async def items(client, user, **params) -> list[dict]:
    response = await client.get(history(user), params=params)
    assert response.status_code == 200
    return response.json()["items"]


# The list

@pytest.mark.parametrize(("status", "winner", "reason", "pro_sees", "con_sees"), [
    ("completed", "pro", "judged", "win", "loss"),
    ("completed", "con", "judged", "loss", "win"),
    ("forfeited", "con", "resigned", "loss", "win"),
    ("forfeited", "pro", "no_prompt", "win", "loss"),
    ("voided", None, "model_failure", "void", "void"),
    ("voided", None, "judge_failure", "void", "void"),
])
async def test_each_player_sees_their_own_outcome(client, log_in, db_session, players, status, winner, reason, pro_sees, con_sees):
    pro, con = players
    await save(db_session, pro, con, status=status, winner=winner, end_reason=reason)
    log_in(pro)
    [as_pro] = await items(client, pro)
    assert (as_pro["outcome"], as_pro["you"], as_pro["status"], as_pro["end_reason"]) == (pro_sees, "pro", status, reason)
    log_in(con)
    [as_con] = await items(client, con)
    assert (as_con["outcome"], as_con["you"]) == (con_sees, "con")


async def test_each_match_shows_the_model_used(client, log_in, db_session, players, topic):
    pro, con = players
    await save(db_session, pro, con, topic=topic, models={pro.id: "Nemotron", con.id: "Nemotron"})
    log_in(pro)
    [match] = await items(client, pro)
    assert match["model"] == "Nemotron" and match["topic"] == "Should transit be free?"


async def test_byom_players_each_see_their_own_model_and_not_their_opponents(client, log_in, db_session, players):
    pro, con = players
    match_id = await save(db_session, pro, con, models={pro.id: "my-secret-finetune", con.id: "llama3.2:3b"})
    log_in(con)
    [listed] = await items(client, con)
    assert listed["model"] == "llama3.2:3b"
    response = await client.get(f"{MATCH}{match_id}")
    assert "my-secret-finetune" not in response.text and response.json()["model"] == "llama3.2:3b"


async def test_unrecorded_model_is_null(client, log_in, db_session, players):
    pro, con = players
    await save(db_session, pro, con, models={})
    log_in(pro)
    assert (await items(client, pro))[0]["model"] is None


async def test_the_model_name_survives_the_model_being_removed(client, log_in, db_session, players, make_model):
    pro, con = players
    model = await make_model()
    await save(db_session, pro, con, model_id=model.id, models={pro.id: "Old name", con.id: "Old name"})
    await db_session.delete(await db_session.get(Model, model.id))
    await db_session.commit()
    log_in(pro)
    assert (await items(client, pro))[0]["model"] == "Old name"


async def test_newest_first_and_only_the_callers_matches(client, log_in, db_session, players, make_user):
    pro, con = players
    other = await make_user("other_hen")
    old = await save(db_session, pro, con, when=NOON)
    new = await save(db_session, con, pro, when=NOON + timedelta(days=1), winner="con")
    await save(db_session, con, other, when=NOON + timedelta(days=2))
    log_in(pro)
    assert [match["id"] for match in await items(client, pro)] == [str(new), str(old)]


async def test_no_matches_is_an_empty_page(client, log_in, make_user):
    viewer = await make_user("viewer")
    log_in(viewer)
    assert (await client.get(history(viewer))).json() == {"items": [], "next_offset": None}


async def test_pages_are_stable(client, log_in, db_session, players):
    pro, con = players
    # The same moment, so only the tie-break keeps pages from overlapping.
    saved = {await save(db_session, pro, con) for _ in range(5)}
    log_in(pro)
    seen = []
    offset = 0
    while offset is not None:
        page = (await client.get(history(pro), params={"limit": 2, "offset": offset})).json()
        seen += [match["id"] for match in page["items"]]
        offset = page["next_offset"]
    assert len(seen) == 5 and set(seen) == {str(match_id) for match_id in saved}


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 51}, {"offset": -1}])
async def test_list_rejects_invalid_params(client, log_in, make_user, params):
    viewer = await make_user("viewer")
    log_in(viewer)
    assert (await client.get(history(viewer), params=params)).status_code == 422


async def test_participants_carry_only_public_fields(client, log_in, db_session, players):
    pro, con = players
    con.email = "secret@example.com"
    await db_session.commit()
    await save(db_session, pro, con)
    log_in(pro)
    response = await client.get(history(pro))
    assert "secret@example.com" not in response.text
    participants = response.json()["items"][0]["participants"]
    assert [p["side"] for p in participants] == ["pro", "con"]
    assert set(participants[1]["user"]) == {"id", "tag", "username", "avatar_url"}
    assert participants[1]["user"]["tag"] == "con_hen"


async def test_a_daily_challenge_match_says_so(client, log_in, db_session, players):
    pro, con = players
    await save(db_session, pro, con, challenge_day=date(2026, 10, 8))
    log_in(pro)
    assert (await items(client, pro))[0]["challenge_day"] == "2026-10-08"


# Who can read it

async def test_another_players_history_is_not_found(client, log_in, db_session, players, make_user):
    pro, con = players
    await save(db_session, pro, con)
    log_in(await make_user("intruder"))
    response = await client.get(history(pro))
    assert response.status_code == 404 and response.json()["code"] == "NOT_FOUND"
    # The opponent can't read it either: only your own history.
    log_in(con)
    assert (await client.get(history(pro))).status_code == 404


async def test_someone_elses_match_looks_the_same_as_a_missing_one(client, log_in, db_session, players, make_user):
    pro, con = players
    match_id = await save(db_session, pro, con)
    log_in(await make_user("intruder"))
    theirs = await client.get(f"{MATCH}{match_id}")
    missing = await client.get(f"{MATCH}{uuid4()}")
    assert theirs.status_code == missing.status_code == 404
    assert theirs.json() == missing.json()


async def test_malformed_ids_are_rejected(client, log_in, make_user):
    log_in(await make_user("viewer"))
    assert (await client.get("/v1/users/not-a-uuid/matches")).status_code == 422
    assert (await client.get(f"{MATCH}not-a-uuid")).status_code == 422


@pytest.mark.parametrize("path", [f"/v1/users/{uuid4()}/matches", f"{MATCH}{uuid4()}"])
async def test_routes_require_auth(client, path):
    assert (await client.get(path)).status_code == 401


@pytest.mark.parametrize("kind", ["list", "detail"])
async def test_routes_are_rate_limited(client, log_in, make_user, kind):
    viewer = await make_user("viewer")
    log_in(viewer)
    path = history(viewer) if kind == "list" else f"{MATCH}{uuid4()}"
    allowed = 200 if kind == "list" else 404
    assert [(await client.get(path)).status_code for _ in range(21)] == [allowed] * 20 + [429]


# Details

async def test_details_show_the_verdict_positions_and_both_arguments(client, log_in, db_session, players, topic):
    pro, con = players
    match_id = await save(db_session, pro, con, topic=topic, reason="Sharper examples.")
    log_in(con)
    response = await client.get(f"{MATCH}{match_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["verdict_reasoning"] == "Sharper examples."
    assert (body["pro_position"], body["con_position"]) == ("Transit should be free.", "It should not.")
    assert body["outcome"] == "loss"
    assert [(t["index"], t["side"], t["phase"], t["content"], t["truncated"]) for t in body["turns"]] == [
        (0, "pro", "opening", "Pro argument.", False), (1, "con", "opening", "Con argument.", False),
    ]


async def test_prompts_are_never_returned(client, log_in, db_session, players):
    # The result payload has no prompts to save, and neither does any response.
    pro, con = players
    match_id = await save(db_session, pro, con)
    log_in(pro)
    for response in (await client.get(history(pro)), await client.get(f"{MATCH}{match_id}")):
        assert "prompt" not in response.text.lower() and "strategy" not in response.text.lower()


async def test_a_side_with_no_argument_has_no_turn(client, log_in, db_session, players):
    pro, con = players
    match_id = await save(db_session, pro, con, status="forfeited", winner="pro", end_reason="no_prompt",
                          arguments={"pro": "I showed up.", "con": "   "})
    log_in(con)
    assert [turn["side"] for turn in (await client.get(f"{MATCH}{match_id}")).json()["turns"]] == ["pro"]


async def test_matches_saved_without_arguments_still_load(client, log_in, db_session, players):
    pro, con = players
    match_id = await save(db_session, pro, con, arguments={})
    log_in(pro)
    assert (await client.get(f"{MATCH}{match_id}")).json()["turns"] == []


async def test_truncated_turns_are_marked(client, log_in, db_session, players):
    pro, con = players
    match_id = await save(db_session, pro, con, truncated=frozenset({"con"}))
    log_in(pro)
    turns = (await client.get(f"{MATCH}{match_id}")).json()["turns"]
    assert {turn["side"]: turn["truncated"] for turn in turns} == {"pro": False, "con": True}


async def test_nul_bytes_from_a_model_dont_lose_the_result(client, log_in, db_session, players):
    pro, con = players
    match_id = await save(db_session, pro, con, arguments={"pro": "Free\x00 transit", "con": "No\x00."}, reason="Fine\x00.")
    await db_session.refresh(pro)
    assert pro.points == 20  # the result and points were saved
    log_in(pro)
    body = (await client.get(f"{MATCH}{match_id}")).json()
    assert body["turns"][0]["content"] == "Free transit" and body["verdict_reasoning"] == "Fine."


async def test_html_in_arguments_comes_back_as_plain_text(client, log_in, db_session, players):
    pro, con = players
    hostile = "<script>alert(1)</script>"
    match_id = await save(db_session, pro, con, arguments={"pro": hostile, "con": "Fine."})
    log_in(pro)
    response = await client.get(f"{MATCH}{match_id}")
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["turns"][0]["content"] == hostile  # unchanged data; the page shows it as text


# Removed players and topics

async def test_a_player_deleted_mid_match_still_leaves_the_opponent_their_result(client, log_in, db_session, players):
    pro, con = players
    await db_session.delete(con)
    await db_session.commit()
    match_id = await save(db_session, pro, con, status="forfeited", end_reason="resigned")
    log_in(pro)
    [item] = (await client.get(history(pro))).json()["items"]
    assert (item["id"], item["outcome"]) == (str(match_id), "win")
    assert [p["user"] for p in item["participants"] if p["side"] == "con"] == [None]


async def test_a_deleted_opponent_leaves_your_history_without_their_details(client, log_in, db_session, players):
    pro, con = players
    match_id = await save(db_session, pro, con)
    await db_session.delete(con)
    await db_session.commit()
    log_in(pro)
    [match] = await items(client, pro)
    assert [p["user"]["tag"] if p["user"] else None for p in match["participants"]] == ["pro_hen", None]
    assert match["outcome"] == "win"
    assert (await client.get(f"{MATCH}{match_id}")).status_code == 200


async def test_a_removed_topic_leaves_the_match(client, log_in, db_session, players, topic):
    pro, con = players
    match_id = await save(db_session, pro, con, topic=topic)
    await db_session.delete(topic)
    await db_session.commit()
    log_in(pro)
    assert (await items(client, pro))[0]["topic"] is None
    body = (await client.get(f"{MATCH}{match_id}")).json()
    assert body["pro_position"] is None and len(body["turns"]) == 2


async def test_deleting_a_match_removes_its_turns(db_session, players):
    from app.models import Match
    pro, con = players
    match_id = await save(db_session, pro, con)
    await db_session.delete(await db_session.get(Match, match_id))
    await db_session.commit()
    assert (await db_session.scalars(select(Turn).where(Turn.match_id == match_id))).all() == []
    assert (await db_session.scalars(select(MatchParticipant).where(MatchParticipant.match_id == match_id))).all() == []
