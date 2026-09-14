import hashlib

import pytest

from app.images import (
    MAX_IMAGE_BYTES,
    ImageStore,
    ImageTooLargeError,
    UnsupportedImageError,
    content_type_for,
    detect_type,
)
from app.items import image_name, sanitize_item

PNG = b"\x89PNG\r\n\x1a\n" + b"payload"
JPEG = b"\xff\xd8\xff" + b"payload"
GIF = b"GIF89a" + b"payload"
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"payload"


@pytest.mark.parametrize(
    "data, expected",
    [
        (PNG, ("image/png", ".png")),
        (JPEG, ("image/jpeg", ".jpg")),
        (GIF, ("image/gif", ".gif")),
        (b"GIF87a" + b"x", ("image/gif", ".gif")),
        (WEBP, ("image/webp", ".webp")),
        (b"not an image at all", None),
        (b"", None),
        (b"RIFF____NOPE", None),
    ],
)
def test_the_type_comes_from_the_bytes(data, expected):
    assert detect_type(data) == expected


def test_a_lying_content_type_cannot_smuggle_anything_in(tmp_path):
    """An HTML payload labelled image/png must not be stored and served back."""
    store = ImageStore(tmp_path)
    with pytest.raises(UnsupportedImageError):
        store.save(b"<html><script>alert(1)</script></html>")
    assert list(tmp_path.glob("*")) == []


def test_saving_names_the_file_after_its_contents(tmp_path):
    store = ImageStore(tmp_path)
    name = store.save(PNG)
    assert name == f"{hashlib.sha256(PNG).hexdigest()}.png"
    assert (tmp_path / name).read_bytes() == PNG


def test_the_same_picture_is_only_stored_once(tmp_path):
    store = ImageStore(tmp_path)
    assert store.save(PNG) == store.save(PNG)
    assert len(list(tmp_path.glob("*.png"))) == 1


def test_no_temp_file_is_left_behind(tmp_path):
    store = ImageStore(tmp_path)
    store.save(PNG)
    assert [p.suffix for p in tmp_path.iterdir()] == [".png"]


def test_oversized_images_are_refused(tmp_path):
    store = ImageStore(tmp_path)
    with pytest.raises(ImageTooLargeError):
        store.save(b"\x89PNG\r\n\x1a\n" + b"x" * MAX_IMAGE_BYTES)
    with pytest.raises(UnsupportedImageError):
        store.save(b"")


def test_empty_and_unknown_data_is_refused(tmp_path):
    store = ImageStore(tmp_path)
    with pytest.raises(UnsupportedImageError):
        store.save(b"\x00\x01\x02")


@pytest.mark.parametrize(
    "name",
    [
        "../../../etc/passwd",
        "..%2f..%2fboards.json",
        "boards.json",
        "abc.png",
        f"{'a' * 63}.png",
        f"{'a' * 64}.exe",
        f"{'A' * 64}.png",  # hashes are lowercase
    ],
)
def test_only_names_this_store_produced_resolve(tmp_path, name):
    store = ImageStore(tmp_path)
    (tmp_path / "boards.json").write_text("secret", encoding="utf-8")
    assert store.resolve(name) is None


def test_a_stored_name_resolves(tmp_path):
    store = ImageStore(tmp_path)
    name = store.save(PNG)
    assert store.resolve(name) == tmp_path / name


def test_unreferenced_pictures_are_swept_up(tmp_path):
    store = ImageStore(tmp_path)
    kept = store.save(PNG)
    dropped = store.save(JPEG)
    stray = tmp_path / "something-else.txt"
    stray.write_text("leave me alone", encoding="utf-8")

    assert store.collect_garbage({kept}) == 1
    assert (tmp_path / kept).exists()
    assert not (tmp_path / dropped).exists()
    assert stray.exists()  # not ours, not touched


def test_sweeping_an_empty_directory_is_harmless(tmp_path):
    assert ImageStore(tmp_path / "missing").collect_garbage(set()) == 0


@pytest.mark.parametrize(
    "name, expected",
    [
        ("x.png", "image/png"),
        ("x.jpg", "image/jpeg"),
        ("x.gif", "image/gif"),
        ("x.webp", "image/webp"),
        ("x.txt", "application/octet-stream"),
    ],
)
def test_content_type_for_extension(name, expected):
    assert content_type_for(name) == expected


def test_image_items_only_accept_our_own_urls():
    ours = f"/images/{'a' * 64}.png"
    base = {"id": "i1", "type": "image", "x": 1, "y": 2, "width": 300, "height": 200}

    assert sanitize_item({**base, "src": ours})["src"] == ours
    for bad in (
        "http://evil.example/x.png",
        "//evil.example/x.png",
        "/images/../boards.json",
        "/images/short.png",
        f"/images/{'a' * 64}.svg",  # svg can carry script
        "javascript:alert(1)",
        "",
        None,
    ):
        assert sanitize_item({**base, "src": bad}) is None, bad


def test_image_geometry_is_validated_and_rounded():
    base = {"id": "i1", "type": "image", "src": f"/images/{'a' * 64}.png"}
    item = sanitize_item({**base, "x": 1.23456, "y": 2, "width": 300.987, "height": 200})
    assert (item["x"], item["width"]) == (1.23, 300.99)

    for missing in ("x", "y", "width", "height"):
        assert sanitize_item({**base, "x": 1, "y": 2, "width": 3, "height": 4, missing: None}) is None

    huge = sanitize_item({**base, "x": 0, "y": 0, "width": 99999, "height": 99999})
    assert (huge["width"], huge["height"]) == (10000, 10000)


def test_image_name_extraction():
    assert image_name(f"/images/{'a' * 64}.png") == f"{'a' * 64}.png"
    assert image_name("http://evil/x.png") is None
