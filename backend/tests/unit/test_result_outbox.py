import asyncio
import os
import subprocess
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.services.result_outbox import ResultOutbox, decode, encode
from app.services.rewards import MatchReport, _advance_streak
from verdict_fixture import SCORECARD


def report():
    return MatchReport(uuid4(), None, None, None, {uuid4(): 'pro', uuid4(): 'con'},
                       {'status': 'completed', 'winner': 'pro', 'end_reason': 'judged',
                        'reason': 'ok', 'arguments': {'pro': 'argument', 'con': 'reply'}}, datetime.now(UTC))


async def test_hard_exit_recovers_in_fresh_instance(tmp_path):
    value = report()
    value.result["scorecard"] = SCORECARD
    subprocess.run([os.sys.executable, '-c',
                    'import os,sys; from app.services.result_outbox import ResultOutbox,decode; '
                    'ResultOutbox(sys.argv[1])._save(decode(sys.argv[2])); os._exit(0)',
                    str(tmp_path), encode(value)], check=True)
    assert (tmp_path / f'{value.match_id}.json').stat().st_mode & 0o777 == 0o600
    assert tmp_path.stat().st_mode & 0o777 == 0o700
    writer = AsyncMock()
    await ResultOutbox(tmp_path)._flush(writer)
    assert writer.await_args.args[0] == value
    assert writer.await_count == 1 and not list(tmp_path.glob('*.json'))


def test_legacy_report_still_decodes_without_scores():
    restored = decode(encode(report()))
    assert restored.scorecard is None
    assert "scorecard" not in restored.result


async def test_outage_retains_ordered_backlog(tmp_path):
    box, first = ResultOutbox(tmp_path), report()
    second = replace(report(), ended_at=first.ended_at + timedelta(seconds=1))
    assert not await box.record(first, AsyncMock(side_effect=RuntimeError('offline')))
    writer = AsyncMock()
    assert await ResultOutbox(tmp_path).record(second, writer)
    assert [call.args[0].match_id for call in writer.await_args_list] == [first.match_id, second.match_id]
    assert not list(tmp_path.glob('*.json'))


async def test_background_retry_recovers_without_new_match(tmp_path):
    box = ResultOutbox(tmp_path)
    box.RETRY_SECONDS = 0.01
    box._save(report())
    writer = AsyncMock(side_effect=[RuntimeError('offline'), None])
    task = asyncio.create_task(box.run(writer))
    try:
        async with asyncio.timeout(1):
            while list(tmp_path.glob('*.json')):
                await asyncio.sleep(0.01)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    assert writer.await_count == 2


async def test_database_attempt_is_bounded(tmp_path):
    box = ResultOutbox(tmp_path)
    box.WRITE_TIMEOUT = 0.01
    async def blocked(value):
        await asyncio.Event().wait()
    assert not await box.record(report(), blocked)
    assert list(tmp_path.glob('*.json'))


def test_whitelist_and_old_date_streak_guard():
    value = report()
    value.result.update(prompt='private', cookie='secret')
    raw = encode(value)
    assert 'private' not in raw and 'secret' not in raw
    user = SimpleNamespace(streak=9, last_played_at=value.ended_at)
    assert _advance_streak(user, value.ended_at - timedelta(days=1)) == 0
    assert user.streak == 9 and user.last_played_at == value.ended_at


@pytest.mark.records_matches
async def test_disk_failure_prevents_acknowledgement():
    from test_launch_regressions import engine
    from app.services import result_outbox
    game = engine()
    game.result = report().result
    socket = SimpleNamespace(send_json=AsyncMock())
    game.connections[game.players[0]] = socket
    with patch.object(result_outbox.pending_results, '_save', side_effect=OSError('disk full')):
        with pytest.raises(OSError, match='disk full'):
            await game.send_result()
    socket.send_json.assert_not_awaited()


async def test_corrupt_entry_preserved_but_invalid_own_report_fails_closed(tmp_path):
    box, value = ResultOutbox(tmp_path), report()
    own = tmp_path / f'{value.match_id}.json'
    own.write_text('{')
    writer = AsyncMock()
    with pytest.raises(ValueError):
        await box.record(value, writer)
    writer.assert_not_awaited()
    own.rename(tmp_path / 'corrupt.json')
    assert await box.record(value, writer)
    writer.assert_awaited_once()
    assert (tmp_path / 'corrupt.json').exists()


async def test_existing_journal_is_canonical_and_resynced(tmp_path):
    box, value = ResultOutbox(tmp_path), report()
    box._save(value)
    changed = replace(value, result={**value.result, 'reason': 'changed'})
    writer = AsyncMock()
    with patch.object(box, '_sync_directory', wraps=box._sync_directory) as sync:
        assert await box.record(changed, writer)
    assert sync.call_count >= 2
    assert writer.await_args.args[0] == value


async def test_rename_then_directory_sync_failure_is_not_acknowledged(tmp_path):
    box, value = ResultOutbox(tmp_path), report()
    writer = AsyncMock()
    with patch.object(box, '_sync_directory', side_effect=OSError('directory sync failed')):
        with pytest.raises(OSError, match='directory sync failed'):
            await box.record(value, writer)
    writer.assert_not_awaited()
    assert (tmp_path / f'{value.match_id}.json').exists()
    # Retry syncs the already-created entry before allowing DB delivery.
    assert await box.record(value, writer)
    writer.assert_awaited_once()
