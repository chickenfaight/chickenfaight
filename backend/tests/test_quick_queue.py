"""Quick Queue fallback works even when no model queues exist."""
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.services.challenge import today
from app.services.matchmaking import Matchmaker


@pytest.fixture
def catalogue():
    with patch('app.services.matchmaking.SessionFactory'), patch(
        'app.services.matchmaking.ArenaRepository.get_queueable_model_ids', new_callable=AsyncMock,
    ) as lookup:
        lookup.return_value = [uuid4(), uuid4()]
        yield lookup


@pytest.mark.parametrize('count', [2, 5, 6])
async def test_remaining_quick_players_pair_in_order_on_random_models(catalogue, count):
    mm = Matchmaker()
    users = [uuid4() for _ in range(count)]
    for user in users:
        mm.register(user, None, 1000)
    models = [catalogue.return_value[i % 2] for i in range(count // 2)]
    with patch('app.services.matchmaking.random.choice', side_effect=models) as choose, patch(
        'app.services.matchmaking.GameEngine',
    ) as game, patch.object(mm, 'start') as start:
        await mm.match_available_players()
        assert start.call_count == count // 2
        assert choose.call_count == count // 2
        assert all(call.args == (catalogue.return_value,) for call in choose.call_args_list)
        assert [call.args[1] for call in game.call_args_list] == [
            tuple(users[i:i + 2]) for i in range(0, count - 1, 2)
        ]
        assert [call.args[2] for call in game.call_args_list] == models
        match_ids = []
        for first, second in zip(users[::2], users[1::2]):
            assert mm.get_status(first) == mm.get_status(second)
            assert mm.get_status(first)['status'] == 'matched'
            match_ids.append(mm.assignments[first])
        assert len(set(match_ids)) == count // 2
        assert [entry[0] for entry in mm.randomqueue] == users[count // 2 * 2:]
        assert {user: entry.key for user, entry in mm.queued_users.items()} == dict.fromkeys(users[count // 2 * 2:])
        await mm.match_available_players()
        assert start.call_count == count // 2
    catalogue.assert_awaited_once()


async def test_arena_matching_precedes_quick_fallback(catalogue):
    mm = Matchmaker()
    regular, daily, model = uuid4(), uuid4(), uuid4()
    quick = [uuid4() for _ in range(3)]
    mm.register(regular, model, 1000)
    mm.register(daily, model, 1000, today())
    for user in quick:
        mm.register(user, None, 1000)
    with patch('app.services.matchmaking.GameEngine') as game, patch.object(mm, 'start'):
        await mm.match_available_players()
    assert game.call_count == 2
    assert game.call_args_list[0].args[1:] == ((regular, quick[0]), model, None)
    assert game.call_args_list[1].args[1] == tuple(quick[1:])
    assert game.call_args_list[1].args[2] in catalogue.return_value
    assert mm.get_status(daily)["queue"]["mode"] == "daily"


@pytest.mark.parametrize('count', [0, 1])
async def test_no_catalogue_lookup_without_a_pair(catalogue, count):
    mm = Matchmaker()
    for _ in range(count):
        mm.register(uuid4(), None, 1000)
    await mm.match_available_players()
    catalogue.assert_not_awaited()
    assert len(mm.randomqueue) == count


@pytest.mark.parametrize('fails', [False, True])
async def test_unavailable_catalogue_retains_players_and_retries(catalogue, fails):
    mm = Matchmaker()
    users = [uuid4(), uuid4()]
    for user in users:
        mm.register(user, None, 1000)
    entries = list(mm.randomqueue)
    catalogue.return_value = []
    catalogue.side_effect = SQLAlchemyError('offline') if fails else None
    with patch('app.services.matchmaking.GameEngine') as game, patch.object(mm, 'start'):
        await mm.match_available_players()
        game.assert_not_called()
        assert list(mm.randomqueue) == entries
        assert {user: entry.key for user, entry in mm.queued_users.items()} == dict.fromkeys(users)
        assert not mm.assignments
        catalogue.side_effect = None
        catalogue.return_value = [uuid4()]
        await mm.match_available_players()
        game.assert_called_once()
        assert game.call_args.args[1] == tuple(users)


async def test_cancellation_during_catalogue_lookup_is_respected(catalogue):
    mm = Matchmaker()
    users = [uuid4() for _ in range(3)]
    for user in users:
        mm.register(user, None, 1000)

    async def load():
        mm.cancel(users[0])
        return [uuid4()]

    catalogue.side_effect = load
    with patch('app.services.matchmaking.GameEngine') as game, patch.object(mm, 'start'):
        await mm.match_available_players()
    assert game.call_args.args[1] == tuple(users[1:])
    assert mm.get_status(users[0]) == {'status': 'none'}
    assert not mm.randomqueue


async def test_odd_leftover_matches_new_arrival_on_later_pass(catalogue):
    mm = Matchmaker()
    users = [uuid4() for _ in range(4)]
    for user in users[:3]:
        mm.register(user, None, 1000)
    with patch('app.services.matchmaking.GameEngine') as game, patch.object(mm, 'start'):
        await mm.match_available_players()
        assert mm.get_status(users[2])["queue"]["mode"] == "quick"
        first_match = mm.assignments[users[0]]
        mm.register(users[3], None, 1000)
        await mm.match_available_players()
        assert [call.args[1] for call in game.call_args_list] == [tuple(users[:2]), tuple(users[2:])]
        assert mm.assignments[users[2]] == mm.assignments[users[3]] != first_match
        assert not mm.randomqueue
        assert not mm.queued_users


@pytest.mark.parametrize('cancel_count', [1, 2])
async def test_cancellation_during_lookup_can_leave_fewer_than_two_players(catalogue, cancel_count):
    mm = Matchmaker()
    users = [uuid4(), uuid4()]
    for user in users:
        mm.register(user, None, 1000)

    async def load():
        for user in users[:cancel_count]:
            mm.cancel(user)
        return [uuid4()]

    catalogue.side_effect = load
    with patch('app.services.matchmaking.GameEngine') as game, patch.object(mm, 'start'):
        await mm.match_available_players()
        game.assert_not_called()
    assert not mm.assignments
    assert {user: entry.key for user, entry in mm.queued_users.items()} == dict.fromkeys(users[cancel_count:])
    assert [entry[0] for entry in mm.randomqueue] == users[cancel_count:]
