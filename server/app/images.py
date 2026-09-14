"""Storage for pasted and dropped pictures.

Images do not go into the board file. A screenshot runs to hundreds of
kilobytes, and everything in that file is sent to every client on every join —
so pictures are written as their own files and the board only keeps the path.

Files are named after the hash of their contents, which dedupes repeats of the
same screenshot and makes the URL safe to cache forever.
"""

from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path

MAX_IMAGE_BYTES = 8 * 1024 * 1024

# The declared content type is not trusted: the type is read from the bytes, and
# only these four are stored at all.
MAGIC: tuple[tuple[bytes, str, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"GIF87a", "image/gif", ".gif"),
    (b"GIF89a", "image/gif", ".gif"),
)

STORED_NAME = re.compile(r"^[0-9a-f]{64}\.(png|jpg|gif|webp)$")

log = logging.getLogger(__name__)


class ImageTooLargeError(ValueError):
    pass


class UnsupportedImageError(ValueError):
    pass


def detect_type(data: bytes) -> tuple[str, str] | None:
    """Returns (content type, extension) read from the bytes themselves."""
    for magic, content_type, extension in MAGIC:
        if data.startswith(magic):
            return content_type, extension
    # WebP is "RIFF....WEBP"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


def content_type_for(name: str) -> str:
    suffix = Path(name).suffix.lower()
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }.get(suffix, "application/octet-stream")


class ImageStore:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def save(self, data: bytes) -> str:
        """Stores the bytes and returns the name to reference them by."""
        if not data:
            raise UnsupportedImageError("空のデータです")
        if len(data) > MAX_IMAGE_BYTES:
            raise ImageTooLargeError(
                f"画像が大きすぎます ({len(data) // 1024} KB > {MAX_IMAGE_BYTES // 1024} KB)"
            )
        detected = detect_type(data)
        if detected is None:
            raise UnsupportedImageError("対応していない画像形式です (PNG / JPEG / GIF / WebP)")

        _, extension = detected
        name = f"{hashlib.sha256(data).hexdigest()}{extension}"
        path = self.directory / name
        if not path.exists():
            self.directory.mkdir(parents=True, exist_ok=True)
            temp = path.with_suffix(path.suffix + ".tmp")
            temp.write_bytes(data)
            temp.replace(path)
        return name

    def resolve(self, name: str) -> Path | None:
        """Maps a requested name to a file, or None if it is not one of ours.

        Only names this store could have produced are accepted, so a request can
        never walk out of the directory.
        """
        if not STORED_NAME.match(name):
            return None
        path = self.directory / name
        return path if path.is_file() else None

    def collect_garbage(self, referenced: set[str]) -> int:
        """Deletes stored files no board refers to any more. Returns the count."""
        if not self.directory.is_dir():
            return 0
        removed = 0
        for path in self.directory.iterdir():
            if not path.is_file():
                continue
            if path.name in referenced:
                continue
            # Leave anything unrecognised alone rather than guessing.
            if not STORED_NAME.match(path.name) and not path.name.endswith(".tmp"):
                continue
            try:
                path.unlink()
                removed += 1
            except OSError as error:
                log.warning("画像を削除できませんでした (%s): %s", path.name, error)
        return removed
