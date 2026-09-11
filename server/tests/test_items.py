import math

from app.items import normalize_room_id, sanitize_item, sanitize_points


def test_stroke_is_rebuilt_from_known_fields():
    item = sanitize_item(
        {
            "id": "s1",
            "type": "stroke",
            "color": "#ef4444",
            "size": 12,
            "simulatePressure": True,
            "erase": False,
            "points": [[1, 2, 0.5], [3, 4, 0.9]],
            "somethingElse": "dropped",
        }
    )
    assert item == {
        "id": "s1",
        "type": "stroke",
        "color": "#ef4444",
        "size": 12.0,
        "simulatePressure": True,
        "erase": False,
        "points": [[1.0, 2.0, 0.5], [3.0, 4.0, 0.9]],
    }


def test_text_is_rebuilt_from_known_fields():
    item = sanitize_item(
        {"id": "t1", "type": "text", "x": 10, "y": 20, "text": "こんにちは", "size": 24}
    )
    assert item == {
        "id": "t1",
        "type": "text",
        "color": "#111827",
        "size": 24.0,
        "x": 10.0,
        "y": 20.0,
        "text": "こんにちは",
    }


def test_sizes_are_clamped():
    stroke = sanitize_item({"id": "s", "points": [[0, 0]], "size": 9999})
    assert stroke["size"] == 200
    stroke = sanitize_item({"id": "s", "points": [[0, 0]], "size": -5})
    assert stroke["size"] == 1
    stroke = sanitize_item({"id": "s", "points": [[0, 0]], "size": "big"})
    assert stroke["size"] == 8


def test_malformed_payloads_are_rejected():
    assert sanitize_item(None) is None
    assert sanitize_item("nope") is None
    assert sanitize_item({"id": 42, "points": []}) is None
    assert sanitize_item({"id": "s", "points": "nope"}) is None
    assert sanitize_item({"id": "", "points": []}) is None
    assert sanitize_item({"id": "t", "type": "text", "x": 1, "y": 2, "text": "   "}) is None
    assert sanitize_item({"id": "t", "type": "text", "x": "a", "y": 2, "text": "hi"}) is None


def test_non_finite_coordinates_are_dropped():
    points = sanitize_points([[1, 2], [math.inf, 3], [4, math.nan], [5, 6]])
    assert points == [[1.0, 2.0, 0.5], [5.0, 6.0, 0.5]]


def test_missing_pressure_defaults_to_a_half():
    assert sanitize_points([[1, 2]]) == [[1.0, 2.0, 0.5]]


def test_booleans_are_not_treated_as_coordinates():
    assert sanitize_points([[True, False]]) == []


def test_long_payloads_are_truncated():
    stroke = sanitize_item({"id": "x" * 200, "points": [[0, 0]] * 20_000})
    assert len(stroke["id"]) == 64
    assert len(stroke["points"]) == 10_000

    text = sanitize_item({"id": "t", "type": "text", "x": 0, "y": 0, "text": "あ" * 900})
    assert len(text["text"]) == 500


def test_room_ids_keep_only_safe_characters():
    assert normalize_room_id("team-a") == "team-a"
    assert normalize_room_id(["team_b"]) == "team_b"
    assert normalize_room_id("../../etc/passwd") == "etcpasswd"
    assert normalize_room_id("  ") == "lobby"
    assert normalize_room_id(None) == "lobby"
    assert normalize_room_id("会議室") == "lobby"
    assert len(normalize_room_id("x" * 200)) == 64
