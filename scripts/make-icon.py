"""Draw the tray and window icon. Run from the repo root: python3 scripts/make-icon.py"""

import math
import struct
import zlib
from pathlib import Path


def write_png(path: Path, size: int, pixel) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def cover(size: int):
    ink = (36, 92, 74)

    def pixel(x: int, y: int):
        cx = (size - 1) / 2
        cy = (size - 1) / 2
        dx = (x - cx) / size
        dy = (y - cy) / size
        distance = math.hypot(dx, dy)
        ring = abs(distance - 0.30)
        ring_alpha = max(0.0, min(1.0, (0.07 - ring) * size))
        dot = max(0.0, min(1.0, (0.07 - distance) * size))
        alpha = max(ring_alpha, dot)
        return (ink[0], ink[1], ink[2], int(round(alpha * 255)))

    return pixel


if __name__ == "__main__":
    out = Path("assets")
    out.mkdir(exist_ok=True)
    write_png(out / "icon.png", 512, cover(512))
