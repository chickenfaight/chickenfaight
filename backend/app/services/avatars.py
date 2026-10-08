"""Profile picture processing. Every upload is decoded and re-encoded, never stored as sent: that
drops EXIF metadata (including GPS location) and anything hidden in a file that only looks like an image."""

import io

from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.exceptions import AvatarInvalidError

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
SIZE = 256
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}
# Rejects decompression bombs: a small file that expands to a huge image in memory.
MAX_PIXELS = 25_000_000


def process_avatar(data: bytes) -> bytes:
    """A square SIZE x SIZE WebP of the uploaded PNG/JPEG/WebP, or AvatarInvalidError."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in ALLOWED_FORMATS:
                raise AvatarInvalidError()
            if image.width * image.height > MAX_PIXELS:
                raise AvatarInvalidError()
            image.load()  # decode fully now, so a truncated or corrupt file fails here
            image = ImageOps.exif_transpose(image)  # respect the camera's rotation before dropping EXIF
            image = image.convert("RGBA" if image.mode in ("RGBA", "LA", "P") else "RGB")
            square = ImageOps.fit(image, (SIZE, SIZE), method=Image.Resampling.LANCZOS)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise AvatarInvalidError() from None
    output = io.BytesIO()
    square.save(output, format="WEBP", quality=85)  # no EXIF is written
    return output.getvalue()
