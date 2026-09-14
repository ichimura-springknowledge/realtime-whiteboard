"""Realtime whiteboard server.

Socket.IO carries the drawing events; FastAPI serves the built client and a
health endpoint. Both are gated on the caller's address so the board stays
inside the local network.
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

import socketio
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .access import AccessGuard
from .board import Rooms
from .images import ImageStore, ImageTooLargeError, UnsupportedImageError, content_type_for
from .items import _is_finite, image_name, normalize_room_id, sanitize_item, sanitize_points
from .store import BoardStore

SERVER_DIR = Path(__file__).resolve().parent.parent
CLIENT_DIST = SERVER_DIR.parent / "client" / "dist"

PORT = int(os.environ.get("PORT") or 5000)
HOST = os.environ.get("HOST") or "0.0.0.0"
ORIGIN = os.environ.get("CLIENT_ORIGIN") or "*"
DATA_FILE = Path(os.environ.get("DATA_FILE") or SERVER_DIR / "data" / "boards.json")
IMAGE_DIR = Path(os.environ.get("IMAGE_DIR") or DATA_FILE.parent / "images")

def _use_utf8_console() -> None:
    """Windows consoles default to a legacy code page, which mangles the
    Japanese in the startup banner and in refusal warnings."""
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        except Exception:  # noqa: BLE001 - cosmetic only, never worth failing over
            pass
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


_use_utf8_console()
logging.basicConfig(level=logging.WARNING, format="%(message)s")

log = logging.getLogger("whiteboard")

guard = AccessGuard(os.environ.get("ALLOWED_CIDRS"))
store = BoardStore(DATA_FILE)
rooms = Rooms(store.load())
images = ImageStore(IMAGE_DIR)

# Refusals are logged once per address, so a colleague who cannot get in can be
# told straight away whether their request even reached this machine.
_refused: set[tuple[str, str | None]] = set()


def _log_refusal(address: str | None, kind: str) -> None:
    key = (kind, address)
    if key in _refused:
        return
    _refused.add(key)
    log.warning("拒否: %s (%s) — 許可範囲: %s", address, kind, guard.describe())


sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=ORIGIN)

# Colours for participant cursors. Assigned by the server so two people never
# pick the same one, and so a client cannot claim someone else's colour.
CURSOR_COLORS = (
    "#ef4444",
    "#3b82f6",
    "#22c55e",
    "#f97316",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
    "#eab308",
)
_next_cursor_color = 0


def _peer_count(room_id: str) -> int:
    return sum(1 for _ in sio.manager.get_participants("/", room_id))


def _persist(*, urgent: bool = False) -> None:
    """`urgent` for changes worth keeping; plain for the flood from a drag."""
    store.save(rooms.snapshot(), urgent=urgent)


def _referenced_images() -> set[str]:
    names = set()
    for _, items in rooms.items():
        for item in items:
            if item["type"] == "image":
                name = image_name(item["src"])
                if name:
                    names.add(name)
    return names


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Pictures outlive the boards that referenced them unless something sweeps
    # up; startup is the one moment nothing is being edited.
    removed = images.collect_garbage(_referenced_images())
    if removed:
        print(f"  使われていない画像を {removed} 件削除しました", flush=True)
    _announce()
    yield
    await store.flush()


api = FastAPI(lifespan=lifespan)


@api.middleware("http")
async def restrict_to_local_network(request: Request, call_next):
    """Refuse anything from outside the network before it reaches a route."""
    address = request.client.host if request.client else None
    if guard.allows(address):
        return await call_next(request)
    _log_refusal(address, "HTTP")
    return PlainTextResponse(
        "このホワイトボードは社内ネットワーク内からのみ利用できます。", status_code=403
    )


@api.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "storage": str(DATA_FILE),
        "allowedFrom": guard.describe(),
        "rooms": [
            {"id": room_id, "items": len(items), "peers": _peer_count(room_id)}
            for room_id, items in rooms.items()
        ],
    }


@api.post("/images")
async def upload_image(request: Request) -> JSONResponse:
    """Takes the raw bytes of a pasted or dropped picture."""
    body = await request.body()
    try:
        name = images.save(body)
    except ImageTooLargeError as error:
        return JSONResponse({"error": str(error)}, status_code=413)
    except UnsupportedImageError as error:
        return JSONResponse({"error": str(error)}, status_code=415)
    return JSONResponse({"src": f"/images/{name}"})


@api.get("/images/{name}")
async def serve_image(name: str):
    path = images.resolve(name)
    if path is None:
        return PlainTextResponse("その画像はありません。", status_code=404)
    return FileResponse(
        path,
        media_type=content_type_for(name),
        # The name is the hash of the contents, so it can never mean anything else.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# Serve the built client when it exists, so the whole board is one address.
if (CLIENT_DIST / "index.html").exists():
    api.mount("/", StaticFiles(directory=CLIENT_DIST, html=True), name="client")


@sio.event
async def connect(sid: str, environ: dict[str, Any]) -> bool:
    scope = environ.get("asgi.scope") or {}
    client = scope.get("client")
    address = client[0] if client else None
    if not guard.allows(address):
        _log_refusal(address, "WebSocket")
        return False

    global _next_cursor_color
    query = parse_qs(environ.get("QUERY_STRING", ""))
    room_id = normalize_room_id(query.get("room"))
    room = rooms.get(room_id)

    color = CURSOR_COLORS[_next_cursor_color % len(CURSOR_COLORS)]
    _next_cursor_color += 1
    await sio.save_session(sid, {"room": room_id, "cursorColor": color})
    await sio.enter_room(sid, room_id)

    await sio.emit("board:init", {"room": room_id, "items": room.items}, to=sid)
    await sio.emit("room:peers", _peer_count(room_id), room=room_id)
    return True


async def _room_of(sid: str) -> tuple[str, Any]:
    session = await sio.get_session(sid)
    room_id = session["room"]
    return room_id, rooms.get(room_id)


@sio.on("cursor:move")
async def cursor_move(sid: str, payload: Any) -> None:
    """Where this participant's pointer is. Not stored: it is gone when they are."""
    if not isinstance(payload, dict):
        return
    x, y = payload.get("x"), payload.get("y")
    if not _is_finite(x) or not _is_finite(y):
        return
    session = await sio.get_session(sid)
    await sio.emit(
        "cursor:move",
        {"id": sid, "x": float(x), "y": float(y), "color": session["cursorColor"]},
        room=session["room"],
        skip_sid=sid,
    )


@sio.on("cursor:leave")
async def cursor_leave(sid: str, *_args: Any) -> None:
    session = await sio.get_session(sid)
    await sio.emit("cursor:leave", {"id": sid}, room=session["room"], skip_sid=sid)


@sio.on("stroke:start")
async def stroke_start(sid: str, raw: Any) -> None:
    room_id, room = await _room_of(sid)
    stroke = sanitize_item(raw)
    if stroke is None or stroke["type"] != "stroke":
        return
    room.live[sid] = stroke["id"]
    await sio.emit("stroke:start", stroke, room=room_id, skip_sid=sid)


@sio.on("stroke:points")
async def stroke_points(sid: str, payload: Any) -> None:
    room_id, _ = await _room_of(sid)
    if not isinstance(payload, dict) or not isinstance(payload.get("id"), str):
        return
    points = sanitize_points(payload.get("points"))
    if not points:
        return
    await sio.emit(
        "stroke:points",
        {"id": payload["id"][:64], "points": points},
        room=room_id,
        skip_sid=sid,
    )


@sio.on("shape:preview")
async def shape_preview(sid: str, raw: Any) -> None:
    """A shape being dragged out; resent whole on every frame until released."""
    room_id, room = await _room_of(sid)
    shape = sanitize_item(raw)
    if shape is None or shape["type"] != "shape":
        return
    room.live[sid] = shape["id"]
    await sio.emit("shape:preview", shape, room=room_id, skip_sid=sid)


@sio.on("stroke:end")
async def stroke_end(sid: str, raw: Any) -> None:
    room_id, room = await _room_of(sid)
    stroke = sanitize_item(raw)
    if stroke is None or stroke["type"] != "stroke":
        return
    room.live.pop(sid, None)
    room.append(stroke)
    await sio.emit("item:add", stroke, room=room_id, skip_sid=sid)
    _persist(urgent=True)


@sio.on("item:add")
async def item_add(sid: str, raw: Any) -> None:
    """Text, and anything re-added by redo."""
    room_id, room = await _room_of(sid)
    item = sanitize_item(raw)
    if item is None or room.find(item["id"]) is not None:
        return
    room.live.pop(sid, None)
    room.append(item)
    await sio.emit("item:add", item, room=room_id, skip_sid=sid)
    _persist(urgent=True)


@sio.on("item:move")
async def item_move(sid: str, payload: Any) -> None:
    """Only text carries a position; strokes are fixed where they were drawn."""
    room_id, room = await _room_of(sid)
    if not isinstance(payload, dict):
        return
    moved = room.move(payload.get("id"), payload.get("x"), payload.get("y"))
    if moved is None:
        return
    await sio.emit(
        "item:move",
        {"id": moved["id"], "x": moved["x"], "y": moved["y"]},
        room=room_id,
        skip_sid=sid,
    )
    _persist()


@sio.on("item:remove")
async def item_remove(sid: str, payload: Any) -> None:
    room_id, room = await _room_of(sid)
    if not isinstance(payload, dict):
        return
    if not room.remove(payload.get("id")):
        return
    await sio.emit("item:remove", {"id": payload["id"]}, room=room_id, skip_sid=sid)
    _persist(urgent=True)


@sio.on("board:clear")
async def board_clear(sid: str, *_args: Any) -> None:
    room_id, room = await _room_of(sid)
    room.clear()
    await sio.emit("board:clear", room=room_id)
    _persist(urgent=True)


@sio.event
async def disconnect(sid: str, *_args: Any) -> None:
    try:
        room_id, room = await _room_of(sid)
    except KeyError:
        return

    live_id = room.live.pop(sid, None)
    if live_id:
        await sio.emit("stroke:cancel", {"id": live_id}, room=room_id, skip_sid=sid)
    await sio.emit("cursor:leave", {"id": sid}, room=room_id, skip_sid=sid)
    await sio.emit("room:peers", _peer_count(room_id), room=room_id)

    # An empty board with nobody in it is worth forgetting; a drawn one is not.
    if _peer_count(room_id) == 0 and not room.items:
        rooms.discard(room_id)
        _persist()


def _lan_addresses() -> list[str]:
    """The addresses colleagues should actually type, rather than localhost."""
    import socket

    addresses: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = info[4][0]
            if not address.startswith("127.") and address not in addresses:
                addresses.append(address)
    except OSError:
        pass
    return addresses


def _say(message: str) -> None:
    print(message, flush=True)


def _announce() -> None:
    total = sum(len(items) for _, items in rooms.items())
    pictures = len(_referenced_images())
    _say(f"whiteboard server listening on port {PORT} (bound to {HOST})")
    _say(f"  接続を許可する範囲: {guard.describe()}")
    _say(f"  保存先: {DATA_FILE} ({len(list(rooms.items()))} ルーム / {total} 要素を復元)")
    if pictures:
        _say(f"  画像: {IMAGE_DIR} ({pictures} 件)")
    if not (CLIENT_DIST / "index.html").exists():
        _say("  クライアント: 未ビルド (client で npm run build すると同じポートで配信します)")
    _say("  同僚に共有する URL:")
    for address in _lan_addresses():
        _say(f"    http://{address}:{PORT}/")


app = socketio.ASGIApp(sio, other_asgi_app=api)
