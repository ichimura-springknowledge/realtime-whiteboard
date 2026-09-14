"""The things a board holds, and the sanitising every incoming payload passes.

Clients send whatever they like, so nothing reaches a room until it has been
rebuilt here from known-good fields.
"""

from __future__ import annotations

import math
import re
from typing import Any, Literal, TypedDict

MAX_POINTS_PER_MESSAGE = 10_000
MAX_TEXT_LENGTH = 500
MAX_ID_LENGTH = 64
MAX_COLOR_LENGTH = 32

DEFAULT_COLOR = "#111827"

# Coordinates are rounded before they are stored or forwarded. A hundredth of a
# pixel is far below what any screen shows, and the raw values from a pointer
# device serialise to 18 characters each - which is paid for on every point, on
# the wire and again on disk.
COORD_PRECISION = 2

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


SHAPE_KINDS = frozenset({"rect", "ellipse", "arrow"})


class ShapeItem(TypedDict):
    id: str
    type: Literal["shape"]
    shape: str
    color: str
    size: float
    x1: float
    y1: float
    x2: float
    y2: float


class ImageItem(TypedDict):
    id: str
    type: Literal["image"]
    src: str
    x: float
    y: float
    width: float
    height: float


BoardItem = StrokeItem | TextItem | ShapeItem | ImageItem


def _is_finite(value: Any) -> bool:
    # bool is an int subclass; coordinates are never booleans.
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def round_coord(value: float) -> float:
    return round(float(value), COORD_PRECISION)


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
        points.append(
            [
                round_coord(x),
                round_coord(y),
                round_coord(pressure) if _is_finite(pressure) else 0.5,
            ]
        )
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
        x=round_coord(x),
        y=round_coord(y),
        text=text,
    )


def sanitize_shape(raw: dict[str, Any]) -> ShapeItem | None:
    item_id = sanitize_id(raw.get("id"))
    kind = raw.get("shape")
    if item_id is None or kind not in SHAPE_KINDS:
        return None
    corners = [raw.get("x1"), raw.get("y1"), raw.get("x2"), raw.get("y2")]
    if not all(_is_finite(value) for value in corners):
        return None

    x1, y1, x2, y2 = (round_coord(value) for value in corners)
    return ShapeItem(
        id=item_id,
        type="shape",
        shape=kind,
        color=sanitize_color(raw.get("color")),
        size=clamp(raw.get("size"), 1, 100, 4),
        x1=x1,
        y1=y1,
        x2=x2,
        y2=y2,
    )


# Only names this server handed out; anything else would let a board point a
# viewer's browser at an arbitrary URL.
_IMAGE_SRC = re.compile(r"^/images/[0-9a-f]{64}\.(png|jpg|gif|webp)$")


def sanitize_image(raw: dict[str, Any]) -> ImageItem | None:
    item_id = sanitize_id(raw.get("id"))
    src = raw.get("src")
    if item_id is None or not isinstance(src, str) or not _IMAGE_SRC.match(src):
        return None
    if not all(_is_finite(raw.get(key)) for key in ("x", "y", "width", "height")):
        return None
    width = clamp(raw.get("width"), 1, 10000, 200)
    height = clamp(raw.get("height"), 1, 10000, 200)

    return ImageItem(
        id=item_id,
        type="image",
        src=src,
        x=round_coord(raw["x"]),
        y=round_coord(raw["y"]),
        width=round_coord(width),
        height=round_coord(height),
    )


def sanitize_item(raw: Any) -> BoardItem | None:
    if not isinstance(raw, dict):
        return None
    kind = raw.get("type")
    if kind == "text":
        return sanitize_text(raw)
    if kind == "shape":
        return sanitize_shape(raw)
    if kind == "image":
        return sanitize_image(raw)
    return sanitize_stroke(raw)


def image_name(src: str) -> str | None:
    """The stored file name behind an image item's src."""
    return src.rsplit("/", 1)[-1] if _IMAGE_SRC.match(src) else None


def normalize_room_id(value: Any) -> str:
    """Room ids come straight from a query string, so keep them to safe characters."""
    raw = value[0] if isinstance(value, list) and value else value
    text = "" if raw is None else str(raw)
    cleaned = "".join(ch for ch in text.strip() if ch.isascii() and (ch.isalnum() or ch in "_-"))
    return cleaned[:64] or "lobby"
