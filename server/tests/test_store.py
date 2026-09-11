import asyncio
import json

from app.board import Room, Rooms
from app.store import BoardStore

STROKE = {
    "id": "s1",
    "type": "stroke",
    "color": "#111827",
    "size": 8.0,
    "simulatePressure": True,
    "erase": False,
    "points": [[0.0, 0.0, 0.5]],
}
TEXT = {
    "id": "t1",
    "type": "text",
    "color": "#111827",
    "size": 24.0,
    "x": 4.0,
    "y": 5.0,
    "text": "退勤前のメモ",
}


def test_missing_file_loads_as_empty(tmp_path):
    assert BoardStore(tmp_path / "nothing.json").load() == {}


def test_round_trip_survives_a_restart(tmp_path):
    path = tmp_path / "boards.json"
    BoardStore(path).write_now({"team-a": [STROKE, TEXT]})

    restored = BoardStore(path).load()
    assert restored == {"team-a": [STROKE, TEXT]}
    assert restored["team-a"][1]["text"] == "退勤前のメモ"


def test_empty_rooms_are_not_written(tmp_path):
    path = tmp_path / "boards.json"
    BoardStore(path).write_now({"drawn": [STROKE], "empty": []})
    assert list(json.loads(path.read_text(encoding="utf-8"))["rooms"]) == ["drawn"]


def test_a_corrupt_file_is_set_aside_rather_than_crashing(tmp_path):
    path = tmp_path / "boards.json"
    path.write_text("{ this is not json", encoding="utf-8")

    assert BoardStore(path).load() == {}
    assert not path.exists()
    assert list(tmp_path.glob("boards.broken-*"))


def test_no_temp_file_is_left_behind(tmp_path):
    path = tmp_path / "boards.json"
    BoardStore(path).write_now({"a": [STROKE]})
    assert [p.name for p in tmp_path.iterdir()] == ["boards.json"]


async def test_saves_are_debounced_into_one_write(tmp_path):
    path = tmp_path / "boards.json"
    store = BoardStore(path, debounce_seconds=0.05)
    rooms = Rooms()
    rooms.get("a").append(STROKE)

    for _ in range(5):
        store.save(rooms.snapshot())
    assert not path.exists()  # nothing written yet

    await asyncio.sleep(0.15)
    assert json.loads(path.read_text(encoding="utf-8"))["rooms"]["a"] == [STROKE]


async def test_flush_writes_immediately_on_shutdown(tmp_path):
    path = tmp_path / "boards.json"
    store = BoardStore(path, debounce_seconds=30)
    store.save({"a": [STROKE]})

    await store.flush()
    assert json.loads(path.read_text(encoding="utf-8"))["rooms"]["a"] == [STROKE]


def test_room_keeps_items_bounded():
    room = Room()
    for index in range(3010):
        room.append({**STROKE, "id": f"s{index}"})
    assert len(room.items) == 3000
    assert room.items[0]["id"] == "s10"  # the oldest fell off


def test_room_move_only_applies_to_text():
    room = Room([dict(STROKE), dict(TEXT)])
    assert room.move("t1", 40, 50)["x"] == 40
    assert room.find("t1")["y"] == 50
    assert room.move("s1", 1, 2) is None  # strokes cannot be moved
    assert room.move("missing", 1, 2) is None
    assert room.move("t1", "a", 2) is None


def test_room_remove_and_clear():
    room = Room([dict(STROKE), dict(TEXT)])
    assert room.remove("s1") is True
    assert room.remove("s1") is False
    assert room.remove(None) is False
    room.clear()
    assert room.items == []
