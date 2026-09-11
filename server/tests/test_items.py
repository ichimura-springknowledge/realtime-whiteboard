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


def test_shape_is_rebuilt_from_known_fields():
    item = sanitize_item(
        {"id": "r1", "type": "shape", "shape": "rect", "x1": 1, "y1": 2, "x2": 3, "y2": 4}
    )
    assert item == {
        "id": "r1",
        "type": "shape",
        "shape": "rect",
        "color": "#111827",
        "size": 4.0,
        "x1": 1.0,
        "y1": 2.0,
        "x2": 3.0,
        "y2": 4.0,
    }


def test_every_shape_kind_is_accepted():
    for kind in ("rect", "ellipse", "arrow"):
        item = sanitize_item(
            {"id": "s", "type": "shape", "shape": kind, "x1": 0, "y1": 0, "x2": 1, "y2": 1}
        )
        assert item["shape"] == kind


def test_unknown_shape_kinds_are_rejected():
    assert (
        sanitize_item(
            {"id": "s", "type": "shape", "shape": "triangle", "x1": 0, "y1": 0, "x2": 1, "y2": 1}
        )
        is None
    )


def test_shapes_need_all_four_finite_corners():
    base = {"id": "s", "type": "shape", "shape": "rect", "x1": 0, "y1": 0, "x2": 1, "y2": 1}
    assert sanitize_item(base) is not None
    for missing in ("x1", "y1", "x2", "y2"):
        assert sanitize_item({**base, missing: None}) is None
    assert sanitize_item({**base, "x2": math.inf}) is None
    assert sanitize_item({**base, "y2": "10"}) is None


def test_shape_line_width_is_clamped():
    base = {"id": "s", "type": "shape", "shape": "rect", "x1": 0, "y1": 0, "x2": 1, "y2": 1}
    assert sanitize_item({**base, "size": 9999})["size"] == 100
    assert sanitize_item({**base, "size": 0})["size"] == 1
    assert sanitize_item({**base, "size": None})["size"] == 4


def test_coordinates_are_rounded_before_storage():
    """Raw pointer values serialise to 18 characters each; two decimals is plenty."""
    stroke = sanitize_item({"id": "s", "points": [[21.48442375552714, 22.876553231625216, 0.5123]]})
    assert stroke["points"] == [[21.48, 22.88, 0.51]]

    text = sanitize_item(
        {"id": "t", "type": "text", "x": 1.23456789, "y": 9.87654321, "text": "x"}
    )
    assert (text["x"], text["y"]) == (1.23, 9.88)

    shape = sanitize_item(
        {
            "id": "r",
            "type": "shape",
            "shape": "rect",
            "x1": 0.111111,
            "y1": 0.555555,
            "x2": 1.994999,
            "y2": 2.0,
        }
    )
    assert (shape["x1"], shape["y1"], shape["x2"], shape["y2"]) == (0.11, 0.56, 1.99, 2.0)


def test_rounding_keeps_whole_numbers_exact():
    stroke = sanitize_item({"id": "s", "points": [[100, 250, 1]]})
    assert stroke["points"] == [[100.0, 250.0, 1.0]]
