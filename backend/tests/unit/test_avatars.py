import io

import pytest
from PIL import Image

from app.services.avatars import SIZE, process_avatar
from app.services.exceptions import AvatarInvalidError


def encode(image: Image.Image, fmt: str, **options) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **options)
    return buffer.getvalue()


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
def test_accepted_formats_become_square_webp(fmt):
    output = process_avatar(encode(Image.new("RGB", (800, 400), "red"), fmt))
    with Image.open(io.BytesIO(output)) as result:
        assert (result.format, result.size) == ("WEBP", (SIZE, SIZE))


def test_exif_including_gps_is_removed():
    image = Image.new("RGB", (300, 300), "blue")
    exif = Image.Exif()
    exif[0x8825] = {2: (40.0, 26.0, 0.0)}  # GPSInfo: latitude
    exif[0x010F] = "SecretCam"  # camera make
    output = process_avatar(encode(image, "JPEG", exif=exif))
    with Image.open(io.BytesIO(output)) as result:
        assert not result.getexif()
    assert b"SecretCam" not in output


def test_camera_rotation_is_applied():
    tall = Image.new("RGB", (100, 300), "green")
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90° clockwise to display
    output = process_avatar(encode(tall, "JPEG", exif=exif))
    with Image.open(io.BytesIO(output)) as result:
        assert result.size == (SIZE, SIZE)


def test_transparency_is_kept():
    output = process_avatar(encode(Image.new("RGBA", (64, 64), (0, 0, 0, 0)), "PNG"))
    with Image.open(io.BytesIO(output)) as result:
        assert result.mode == "RGBA"


@pytest.mark.parametrize("data", [
    b"",
    b"not an image at all",
    b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
    b"\x89PNG\r\n\x1a\n" + b"\x00" * 64,  # PNG signature, garbage after
])
def test_non_images_are_rejected(data):
    with pytest.raises(AvatarInvalidError):
        process_avatar(data)


def test_other_formats_are_rejected():
    with pytest.raises(AvatarInvalidError):
        process_avatar(encode(Image.new("RGB", (10, 10)), "GIF"))


def test_huge_dimensions_are_rejected_without_decoding():
    # A tiny file claiming 6000x6000 pixels (36 MP) would take lots of memory to decode.
    with pytest.raises(AvatarInvalidError):
        process_avatar(encode(Image.new("1", (6000, 6000)), "PNG", optimize=True))


def test_truncated_file_is_rejected():
    data = encode(Image.new("RGB", (200, 200), "red"), "JPEG")
    with pytest.raises(AvatarInvalidError):
        process_avatar(data[: len(data) // 2])
