"""The things a board holds, and the sanitising every incoming payload passes.

Clients send whatever they like, so nothing reaches a room until it has been
rebuilt here from known-good fields.
"""

from __future__ import annotations

import math
from typing import Any, Literal, TypedDict

MAX_POINTS_PER_MESSAGE = 10_000
MAX_TEXT_LENGTH = 500
MAX_ID_LENGTH = 64
MAX_COLOR_LENGTH = 32

DEFAULT_COLOR = "#111827"

Point = list[float]


class StrokeItem(TypedDict):
    id: str
    type: Literal["stroke"]
    color: str
    size: float
    simulatePressure: bool
    erase: bool
    points: list[Point]


class TextItem(TypedDict):
    id: str
    type: Literal["text"]
    color: str
    size: float
    x: float
    y: float
    text: str


BoardItem = StrokeItem | TextItem


def _is_finite(value: Any) -> bool:
    # bool is an int subclass; coordinates are never booleans.
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def clamp(value: Any, low: float, high: float, fallback: float) -> float:
    if not _is_finite(value):
        return fallback
    return float(min(max(value, low), high))


def sanitize_id(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    return value[:MAX_ID_LENGTH]


def sanitize_color(value: Any) -> str:
    return value[:MAX_COLOR_LENGTH] if isinstance(value, str) else DEFAULT_COLOR


def sanitize_points(raw: Any) -> list[Point] | None:
    if not isinstance(raw, list):
        return None
    points: list[Point] = []
    for point in raw[:MAX_POINTS_PER_MESSAGE]:
        if not isinstance(point, list) or len(point) < 2:
            continue
        x, y = point[0], point[1]
        if not _is_finite(x) or not _is_finite(y):
            continue
        pressure = point[2] if len(point) > 2 else None
        points.append([float(x), float(y), float(pressure) if _is_finite(pressure) else 0.5])
    return points


def sanitize_stroke(raw: dict[str, Any]) -> StrokeItem | None:
    item_id = sanitize_id(raw.get("id"))
    points = sanitize_points(raw.get("points"))
    if item_id is None or points is None:
        return None

    return StrokeItem(
        id=item_id,
        type="stroke",
        color=sanitize_color(raw.get("color")),
        size=clamp(raw.get("size"), 1, 200, 8),
        simulatePressure=raw.get("simulatePressure") is not False,
        erase=raw.get("erase") is True,
        points=points,
    )


def sanitize_text(raw: dict[str, Any]) -> TextItem | None:
    item_id = sanitize_id(raw.get("id"))
    value = raw.get("text")
    text = value[:MAX_TEXT_LENGTH] if isinstance(value, str) else ""
    if item_id is None or not text.strip():
        return None
    x, y = raw.get("x"), raw.get("y")
    if not _is_finite(x) or not _is_finite(y):
        return None

    return TextItem(
        id=item_id,
        type="text",
        color=sanitize_color(raw.get("color")),
        size=clamp(raw.get("size"), 8, 200, 24),
        x=float(x),
        y=float(y),
        text=text,
    )


def sanitize_item(raw: Any) -> BoardItem | None:
    if not isinstance(raw, dict):
        return None
    if raw.get("type") == "text":
        return sanitize_text(raw)
    return sanitize_stroke(raw)


def normalize_room_id(value: Any) -> str:
    """Room ids come straight from a query string, so keep them to safe characters."""
    raw = value[0] if isinstance(value, list) and value else value
    text = "" if raw is None else str(raw)
    cleaned = "".join(ch for ch in text.strip() if ch.isascii() and (ch.isalnum() or ch in "_-"))
    return cleaned[:64] or "lobby"
