from contextlib import nullcontext
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.engine.game_engine import GameEngine
from app.models import Ladder, MatchParticipant, Rating, Turn


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
    engine.result = {"status": status, "winner": winner, "end_reason": "resigned", "arguments": {}}
    await report(engine, db_session)
    rows = await participants(db_session, engine)
    assert all(row.elo_before is None and row.elo_after is None for row in rows.values())
