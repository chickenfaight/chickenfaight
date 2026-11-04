from contextlib import nullcontext
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.engine.game_engine import GameEngine
from app.models import Ladder, Rating


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
