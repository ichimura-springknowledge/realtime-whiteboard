"""Keeps the boards on disk so nothing is lost when everyone closes their
browser, or when the server itself is restarted.

Writes are debounced and atomic (temp file + replace), so a crash mid-save
cannot leave a half-written board behind.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import suppress
from pathlib import Path

from .items import BoardItem

FORMAT_VERSION = 1

# How long a change may sit in memory before it reaches the disk. Positions from
# a drag arrive dozens of times a second and rewriting the file that often would
# be wasteful, but a finished stroke is someone's work: if the process is killed
# a moment later, it should already be saved.
URGENT_DEBOUNCE_SECONDS = 0.1

log = logging.getLogger(__name__)


class BoardStore:
    def __init__(self, path: Path, debounce_seconds: float = 1.0) -> None:
        self.path = path
        self._debounce = debounce_seconds
        self._rooms: dict[str, list[BoardItem]] | None = None
        self._task: asyncio.Task[None] | None = None
        self._deadline: float | None = None
        self._last_write = 0.0

    def load(self) -> dict[str, list[BoardItem]]:
        if not self.path.exists():
            return {}
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            rooms = payload.get("rooms")
            if not isinstance(rooms, dict):
                return {}
            return {
                room_id: items
                for room_id, items in rooms.items()
                if isinstance(items, list)
            }
        except (OSError, ValueError) as error:
            # A corrupt file must not stop the server; keep it aside and start clean.
            backup = self.path.with_suffix(f".broken-{int(time.time())}")
            log.error("保存ファイルを読めませんでした (%s)。%s に退避します", error, backup)
            try:
                self.path.replace(backup)
            except OSError:
                pass
            return {}

    def write_now(self, rooms: dict[str, list[BoardItem]] | None = None) -> None:
        source = rooms if rooms is not None else self._rooms
        if source is None:
            return

        payload = {
            "version": FORMAT_VERSION,
            "savedAt": int(time.time() * 1000),
            "rooms": {room_id: items for room_id, items in source.items() if items},
        }
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            temp.replace(self.path)
        except OSError as error:
            log.error("保存に失敗しました: %s", error)
        finally:
            self._last_write = time.monotonic()

    def save(self, rooms: dict[str, list[BoardItem]], *, urgent: bool = False) -> None:
        """Call after any change; the actual write is coalesced.

        `urgent` marks a change worth keeping - a finished stroke, a new text, an
        undo - and shortens the wait. After a quiet spell such a change is
        written at once, so the common case of drawing now and then leaves no
        window at all; during a burst the writes still coalesce.
        """
        self._rooms = rooms

        if not urgent:
            delay = self._debounce
        elif time.monotonic() - self._last_write >= self._debounce:
            delay = 0.0
        else:
            delay = URGENT_DEBOUNCE_SECONDS
        deadline = time.monotonic() + delay

        if self._task is not None and not self._task.done():
            if self._deadline is not None and deadline >= self._deadline:
                return  # an earlier write is already on its way
            self._task.cancel()  # bring it forward

        self._deadline = deadline
        self._task = asyncio.create_task(self._save_after(delay))

    async def _save_after(self, delay: float) -> None:
        if delay > 0:
            await asyncio.sleep(delay)
        self._deadline = None
        await asyncio.to_thread(self.write_now)

    async def flush(self) -> None:
        """Writes straight away, whatever the pending timer was going to do.

        The pending task is cancelled rather than awaited, and the write happens
        here, so a save still lands even when that task never got to start.
        """
        task = self._task
        if task is not None and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        self._deadline = None
        self.write_now()
