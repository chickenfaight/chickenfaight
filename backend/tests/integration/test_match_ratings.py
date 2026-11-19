from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.engine.game_engine import GameEngine
from app.models import Ladder, MatchParticipant, Rating, Turn
from app.services.rewards import record_match


@pytest.mark.records_matches
@pytest.mark.parametrize("winner_index", [0, 1])
async def test_completed_match_uses_both_starting_ratings(db_session, make_user, make_model, winner_index):
    first = await make_user("first")
    second = await make_user("second")
    players = (first.id, second.id)
    model = await make_model()
    ladder = Ladder(slug=f"ladder-{model.id}", display_name=model.display_name, kind="cloud")
    db_session.add(ladder)
    await db_session.commit()

    with patch("app.engine.game_engine.OpenAIModelClient"):
        engine = GameEngine(uuid4(), players, model.id)
    engine.assign_sides(first.id)
    winner_id = players[winner_index]
    loser_id = players[1 - winner_index]
    engine.result = {"status": "completed", "winner": engine.sides[winner_id], "end_reason": "judged"}
    with patch("app.engine.game_engine.SessionFactory", side_effect=lambda: nullcontext(db_session)):
        await engine.report_game()

    winner = await db_session.get(Rating, (winner_id, ladder.id))
    loser = await db_session.get(Rating, (loser_id, ladder.id))
    assert (winner.elo, winner.games_played, winner.wins, winner.losses) == (1016, 1, 1, 0)
    assert (loser.elo, loser.games_played, loser.wins, loser.losses) == (984, 1, 0, 1)


async def report(engine, db_session):
    with patch("app.engine.game_engine.SessionFactory", side_effect=lambda: nullcontext(db_session)):
        await engine.report_game()


async def participants(db_session, engine):
    rows = await db_session.scalars(select(MatchParticipant).where(MatchParticipant.match_id == engine.match_id))
    return {row.user_id: row for row in rows}


@pytest.mark.records_matches
async def test_match_history_records_each_players_elo_change_and_model(db_session, make_user, make_model):
    first, second = await make_user("first"), await make_user("second")
    model = await make_model()
    db_session.add(Ladder(slug=f"ladder-{model.id}", display_name=model.display_name, kind="cloud"))
    await db_session.commit()
    with patch("app.engine.game_engine.OpenAIModelClient"):
        engine = GameEngine(uuid4(), (first.id, second.id), model.id)
    engine.assign_sides(first.id)
    engine.model_names = {first.id: "Test model", second.id: "Test model"}
    engine.arguments = {"pro": "x", "con": "y"}
    winner = engine.sides[first.id]
    engine.result = {"status": "completed", "winner": winner, "end_reason": "judged", "arguments": dict(engine.arguments)}
    await report(engine, db_session)
    rows = await participants(db_session, engine)
    assert (rows[first.id].elo_before, rows[first.id].elo_after) == (1000, 1016)
    assert (rows[second.id].elo_before, rows[second.id].elo_after) == (1000, 984)
    assert rows[first.id].model_name == "Test model"
    turns = (await db_session.scalars(select(Turn).where(Turn.match_id == engine.match_id).order_by(Turn.index))).all()
    assert [(turn.side, turn.content) for turn in turns] == [("pro", "x"), ("con", "y")]


@pytest.mark.records_matches
@pytest.mark.parametrize(("status", "winner"), [("forfeited", "pro"), ("voided", None)])
async def test_matches_that_dont_change_elo_leave_it_blank(db_session, make_user, make_model, status, winner):
    first, second = await make_user("first"), await make_user("second")
    model = await make_model()
    db_session.add(Ladder(slug=f"ladder-{model.id}", display_name=model.display_name, kind="cloud"))
    await db_session.commit()
    with patch("app.engine.game_engine.OpenAIModelClient"):
        engine = GameEngine(uuid4(), (first.id, second.id), model.id)
    engine.assign_sides(first.id)
    engine.result = {"status": status, "winner": winner, "end_reason": "resigned", "arguments": {}}
    await report(engine, db_session)
    rows = await participants(db_session, engine)
    assert all(row.elo_before is None and row.elo_after is None for row in rows.values())


def sockets(engine):
    """Fake player sockets recording what each was sent."""
    sent = {player: [] for player in engine.players}
    engine.joined.update(engine.players)
    for player in engine.players:
        async def send_json(message, player=player):
            sent[player].append(message)
        engine.connections[player] = SimpleNamespace(send_json=send_json)
    return sent


def payload(sent, kind):
    return next(message["payload"] for message in sent if message["type"] == kind)


@pytest.mark.records_matches
async def test_result_message_reports_each_players_elo_before_and_after(db_session, make_user, make_model):
    first, second = await make_user("first"), await make_user("second")
    model = await make_model()
    db_session.add(Ladder(slug=f"ladder-{model.id}", display_name=model.display_name, kind="cloud"))
    await db_session.commit()
    with patch("app.engine.game_engine.OpenAIModelClient"):
        engine = GameEngine(uuid4(), (first.id, second.id), model.id)
    engine.assign_sides(first.id)
    sent = sockets(engine)
    with patch("app.engine.game_engine.SessionFactory", side_effect=lambda: nullcontext(db_session)):
        await engine.broadcast_result({"winner": engine.sides[first.id], "reason": "Better.", "status": "completed", "end_reason": "judged"})
    for player in engine.players:
        result = payload(sent[player], "MATCH_RESULT")
        elo = {entry["user_id"]: (entry["side"], entry["elo_before"], entry["elo_after"]) for entry in result["participants"]}
        assert elo == {str(first.id): (engine.sides[first.id], 1000, 1016), str(second.id): (engine.sides[second.id], 1000, 984)}


@pytest.mark.records_matches
async def test_result_message_leaves_elo_blank_when_ratings_dont_change(db_session, make_user, make_model):
    first, second = await make_user("first"), await make_user("second")
    model = await make_model()
    with patch("app.engine.game_engine.OpenAIModelClient"):
        engine = GameEngine(uuid4(), (first.id, second.id), model.id)
    sent = sockets(engine)
    with patch("app.engine.game_engine.SessionFactory", side_effect=lambda: nullcontext(db_session)):
        await engine.broadcast_result({"winner": None, "reason": "Void.", "status": "voided", "end_reason": "model_failure"})
    result = payload(sent[first.id], "MATCH_RESULT")
    assert {entry["side"] for entry in result["participants"]} == {"pro", "con"}
    assert all(entry["elo_before"] is None and entry["elo_after"] is None for entry in result["participants"])


@pytest.mark.records_matches
async def test_recording_again_returns_the_saved_rating_changes(db_session, make_user, make_model):
    first, second = await make_user("first"), await make_user("second")
    model = await make_model()
    db_session.add(Ladder(slug=f"ladder-{model.id}", display_name=model.display_name, kind="cloud"))
    await db_session.commit()
    with patch("app.engine.game_engine.OpenAIModelClient"):
        engine = GameEngine(uuid4(), (first.id, second.id), model.id)
    engine.assign_sides(first.id)
    engine.result = {"status": "completed", "winner": engine.sides[first.id], "end_reason": "judged", "reason": "x", "arguments": {}}
    await report(engine, db_session)
    expected = {first.id: (1000, 1016), second.id: (1000, 984)}
    assert engine.rating_changes == expected
    assert await record_match(db_session, engine.report) == expected  # a replay awards nothing new


@pytest.mark.records_matches
async def test_match_state_introduces_both_players_with_their_ladder_elo(db_session, make_user, make_model):
    rated, unrated = await make_user("rated"), await make_user("unrated")
    rated.username = "Rated Player"
    model = await make_model()
    ladder = Ladder(slug=f"ladder-{model.id}", display_name=model.display_name, kind="cloud")
    other = Ladder(slug=f"ladder-{uuid4()}", display_name="Elsewhere", kind="cloud")
    db_session.add_all([ladder, other])
    await db_session.flush()
    db_session.add_all([Rating(user_id=rated.id, ladder_id=ladder.id, elo=1234),
                        Rating(user_id=unrated.id, ladder_id=other.id, elo=1500)])
    await db_session.commit()
    with patch("app.engine.game_engine.OpenAIModelClient"):
        engine = GameEngine(uuid4(), (rated.id, unrated.id), model.id)
    engine.assign_sides(engine.players[0])
    engine.model_display_name = "Test model"
    engine.topic = SimpleNamespace(category="C", topic="T", pro_position="P", con_position="N")
    await engine.load_players(db_session)
    sent = sockets(engine)
    await engine.broadcast_initial_game_state()
    for player in engine.players:
        state = payload(sent[player], "MATCH_STATE")
        found = {entry["user_id"]: entry for entry in state["participants"]}
        assert found[str(rated.id)]["user"] == {"id": str(rated.id), "tag": "rated", "username": "Rated Player", "avatar_url": None}
        assert found[str(rated.id)]["elo"] == 1234
        # Unrated on this ladder starts at the default, whatever they have elsewhere.
        assert found[str(unrated.id)]["elo"] == 1000
        assert set(found[str(unrated.id)]["user"]) == {"id", "tag", "username", "avatar_url"}  # never email


async def test_match_state_still_starts_when_players_cant_be_loaded():
    with patch("app.engine.game_engine.OpenAIModelClient"):
        engine = GameEngine(uuid4(), (uuid4(), uuid4()), uuid4())
    broken = SimpleNamespace(scalars=AsyncMock(side_effect=RuntimeError("database down")))
    await engine.load_players(broken)
    engine.assign_sides(engine.players[0])
    engine.model_display_name = "Test model"
    engine.topic = SimpleNamespace(category="C", topic="T", pro_position="P", con_position="N")
    sent = sockets(engine)
    await engine.broadcast_initial_game_state()
    state = payload(sent[engine.players[0]], "MATCH_STATE")
    assert all(entry["user"] is None and entry["elo"] is None for entry in state["participants"])
