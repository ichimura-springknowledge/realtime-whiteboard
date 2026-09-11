"""Room state: the ordered items a board holds, plus the strokes in flight."""

from __future__ import annotations

from typing import Any, Iterator

from .items import BoardItem, _is_finite, sanitize_id

MAX_ITEMS_PER_ROOM = 3000


class Room:
    """The ordered items of one board.

    A board can hold thousands of items and every add, move and undo has to find
    one by id, so the list is paired with an id index. Order still lives in the
    list - the index only answers "which item is this?".
    """

    def __init__(self, items: list[BoardItem] | None = None) -> None:
        self.items: list[BoardItem] = items or []
        self._by_id: dict[str, BoardItem] = {item["id"]: item for item in self.items}
        # sid -> id of the stroke that participant is drawing right now
        self.live: dict[str, str] = {}

    def append(self, item: BoardItem) -> None:
        self.items.append(item)
        self._by_id[item["id"]] = item
        # Oldest items drop out once a room gets very long, to bound memory.
        if len(self.items) > MAX_ITEMS_PER_ROOM:
            oldest = self.items.pop(0)
            self._by_id.pop(oldest["id"], None)

    def find(self, item_id: str) -> BoardItem | None:
        return self._by_id.get(item_id)

    def remove(self, raw_id: Any) -> bool:
        item_id = sanitize_id(raw_id)
        if item_id is None:
            return False
        item = self._by_id.pop(item_id, None)
        if item is None:
            return False
        self.items.remove(item)
        return True

    def move(self, raw_id: Any, x: Any, y: Any) -> BoardItem | None:
        item_id = sanitize_id(raw_id)
        if item_id is None or not _is_finite(x) or not _is_finite(y):
            return None
        item = self.find(item_id)
        if item is None or item["type"] != "text":
            return None
        item["x"] = float(x)
        item["y"] = float(y)
        return item

    def clear(self) -> None:
        self.items = []
        self._by_id.clear()
        self.live.clear()


class Rooms:
    """Every board this server knows about, keyed by room id."""

    def __init__(self, restored: dict[str, list[BoardItem]] | None = None) -> None:
        self._rooms: dict[str, Room] = {
            room_id: Room(items) for room_id, items in (restored or {}).items()
        }

    def get(self, room_id: str) -> Room:
        room = self._rooms.get(room_id)
        if room is None:
            room = Room()
            self._rooms[room_id] = room
        return room

    def discard(self, room_id: str) -> None:
        self._rooms.pop(room_id, None)

    def items(self) -> Iterator[tuple[str, list[BoardItem]]]:
        for room_id, room in self._rooms.items():
            yield room_id, room.items

    def snapshot(self) -> dict[str, list[BoardItem]]:
        return {room_id: room.items for room_id, room in self._rooms.items()}
