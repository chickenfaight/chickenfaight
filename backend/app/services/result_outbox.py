"""Disk-backed decided results, retained until the database transaction commits."""
import asyncio
import json
import logging
import os
import tempfile
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path
from uuid import UUID

from app.config import settings
from app.services.rewards import MatchReport

logger = logging.getLogger(__name__)
Writer = Callable[[MatchReport], Awaitable[None]]


def encode(report: MatchReport) -> str:
    # Explicit payload allowlist: never persist arbitrary model/player fields or prompts.
    payload = asdict(report)
    payload['result'] = {key: report.result[key] for key in
                         ('status', 'winner', 'end_reason', 'reason', 'arguments') if key in report.result}
    if 'arguments' in report.result:
        payload['result']['arguments'] = {side: report.result['arguments'].get(side, '') for side in ('pro', 'con')}
    payload['sides'] = {str(key): value for key, value in report.sides.items()}
    payload['model_names'] = {str(key): value for key, value in report.model_names.items()}
    return json.dumps(payload, default=lambda value: list(value) if isinstance(value, frozenset) else str(value))


def decode(raw: str) -> MatchReport:
    value = json.loads(raw)
    for key in ('match_id', 'model_id', 'topic_id'):
        value[key] = UUID(value[key]) if value[key] else None
    value['sides'] = {UUID(key): side for key, side in value['sides'].items()}
    value['model_names'] = {UUID(key): name for key, name in value['model_names'].items()}
    value['ended_at'] = datetime.fromisoformat(value['ended_at'])
    value['challenge_day'] = date.fromisoformat(value['challenge_day']) if value['challenge_day'] else None
    value['truncated'] = frozenset(value['truncated'])
    return MatchReport(**value)


class ResultOutbox:
    WRITE_TIMEOUT = 10
    RETRY_SECONDS = 5

    def __init__(self, directory: str | Path):
        self.directory = Path(directory).expanduser()
        self.lock = asyncio.Lock()

    def _sync_directory(self):
        fd = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _prepare(self):
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)
        # Persist each newly created directory entry up through its existing parents.
        for parent in (self.directory, *self.directory.parents):
            fd = os.open(parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    def _save(self, report: MatchReport):
        self._prepare()
        target = self.directory / f'{report.match_id}.json'
        if target.exists():
            if decode(target.read_text()).match_id != report.match_id:
                raise ValueError('Result journal identifier mismatch')
            self._sync_directory()
            return
        fd, temporary = tempfile.mkstemp(prefix='.', dir=self.directory)
        try:
            with os.fdopen(fd, 'w') as output:
                output.write(encode(report))
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, target)
            self._sync_directory()
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    async def _io(self, function, *args):
        # Finish filesystem operations before cancellation can release our serialization lock.
        task = asyncio.create_task(asyncio.to_thread(function, *args))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

    def _pending(self):
        if not self.directory.exists():
            return []
        reports = []
        for path in self.directory.glob('*.json'):
            try:
                report = decode(path.read_text())
                if path.name != f'{report.match_id}.json':
                    raise ValueError('Result journal identifier mismatch')
                reports.append(report)
            except (ValueError, KeyError, TypeError):
                logger.exception('Invalid result journal entry %s; preserved for repair', path.name)
        return sorted(reports, key=lambda report: (report.ended_at, str(report.match_id)))

    def _discard(self, report: MatchReport):
        (self.directory / f'{report.match_id}.json').unlink(missing_ok=True)
        self._sync_directory()

    async def _flush(self, writer: Writer, live: MatchReport | None = None):
        for pending in await self._io(self._pending):
            report = live if live is not None and live == pending else pending
            async with asyncio.timeout(self.WRITE_TIMEOUT):
                await writer(report)
            await self._io(self._discard, report)

    async def record(self, report: MatchReport, writer: Writer):
        async with self.lock:
            # Fail closed if durable storage fails: callers must not acknowledge this result.
            await self._io(self._save, report)
            try:
                await self._flush(writer, report)
                return True
            except Exception:
                logger.exception('Match %s: result retained for database recovery', report.match_id)
                return False

    async def run(self, writer: Writer):
        while True:
            try:
                async with self.lock:
                    await self._flush(writer)
            except Exception:
                logger.exception('Pending match results could not be recovered; retrying')
            await asyncio.sleep(self.RETRY_SECONDS)


pending_results = ResultOutbox(settings.match_result_directory)
