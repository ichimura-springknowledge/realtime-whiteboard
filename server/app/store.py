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

log = logging.getLogger(__name__)


class BoardStore:
    def __init__(self, path: Path, debounce_seconds: float = 1.0) -> None:
        self.path = path
        self._debounce = debounce_seconds
        self._rooms: dict[str, list[BoardItem]] | None = None
        self._task: asyncio.Task[None] | None = None

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

    def save(self, rooms: dict[str, list[BoardItem]]) -> None:
        """Call after any change; the actual write is coalesced."""
        self._rooms = rooms
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._save_later())

    async def _save_later(self) -> None:
        await asyncio.sleep(self._debounce)
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
        self.write_now()
