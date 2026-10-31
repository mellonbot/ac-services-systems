#!/usr/bin/env python3
"""S1's yard vegetation for apps/s1-marketing/src/scene.ts: the trimmed lawn the yard is laid
in (tileable, opaque), and two alpha textures drawn as crossed planes — a grass tuft for the
road edges and tall weeds for the fence line.

    python3 tools/textures/vegetation.py   # writes apps/s1-marketing/public/{lawn,grass,weeds}.webp

Like dirt.webp, the vegetation's colour is the asset's, not an ink: a dry
Texas yard — olive, sage and straw — never a lawn green, which would sit on the
status-ok hue. Seeded, so a rerun writes the same bytes.
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / "apps/s1-marketing/public"
BLADE = [(78, 90, 43), (107, 122, 58), (128, 134, 72), (154, 143, 82), (184, 164, 106), (96, 104, 52)]
LAWN = [(86, 100, 50), (98, 112, 56), (110, 122, 62), (78, 92, 46), (122, 128, 70), (104, 110, 60)]
SEED_HEAD = [(170, 150, 98), (140, 118, 74), (196, 178, 128)]


def blade(d, rng, x0, y0, height, width, lean, colour):
    """A tapered, curving blade from (x0, y0) upward."""
    steps = 12
    left, right = [], []
    for i in range(steps + 1):
        t = i / steps
        x = x0 + lean * height * t * t
        y = y0 - height * t
        w = width * (1 - t) ** 0.8
        left.append((x - w / 2, y))
        right.append((x + w / 2, y))
    d.polygon(left + right[::-1], fill=colour + (255,))


def grass(rng):
    w, h = 256, 256
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for _ in range(90):
        x0 = w / 2 + rng.gauss(0, w * 0.17)
        blade(d, rng, x0, h, rng.uniform(0.45, 0.95) * h, rng.uniform(5, 10), rng.uniform(-0.45, 0.45), rng.choice(BLADE))
    return im


def lawn(rng):
    """Mown grass seen from above: short strokes on an olive ground, drawn wrapped so it tiles."""
    n = 512
    im = Image.new("RGB", (n, n), LAWN[0])
    d = ImageDraw.Draw(im)
    for _ in range(26000):
        x, y = rng.uniform(0, n), rng.uniform(0, n)
        a = rng.uniform(-math.pi, math.pi)
        r = rng.uniform(1.5, 4.5)
        dx, dy = math.cos(a) * r, math.sin(a) * r
        colour = rng.choice(LAWN)
        for ox in (-n, 0, n):
            for oy in (-n, 0, n):
                d.line((x + ox, y + oy, x + ox + dx, y + oy + dy), fill=colour, width=2)
    return im


def weeds(rng):
    w, h = 256, 512
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # Broad leaves at the base.
    for _ in range(24):
        x0 = w / 2 + rng.gauss(0, w * 0.12)
        blade(d, rng, x0, h, rng.uniform(0.15, 0.32) * h, rng.uniform(10, 18), rng.uniform(-0.9, 0.9), rng.choice(BLADE))
    # Tall stalks, each with a seed head.
    for _ in range(16):
        x0 = w / 2 + rng.gauss(0, w * 0.14)
        height = rng.uniform(0.6, 0.97) * h
        lean = rng.uniform(-0.18, 0.18)
        colour = rng.choice(BLADE[2:])
        blade(d, rng, x0, h, height, rng.uniform(3, 5), lean, colour)
        tx, ty = x0 + lean * height, h - height
        head = rng.choice(SEED_HEAD) + (255,)
        for k in range(10):
            a = rng.uniform(-math.pi, 0)
            r = rng.uniform(3, 14)
            cx, cy = tx + math.cos(a) * r * 0.7, ty + k * 3 + math.sin(a) * r * 0.3
            d.ellipse((cx - 3, cy - 5, cx + 3, cy + 5), fill=head)
    # Thin grass among them.
    for _ in range(40):
        x0 = w / 2 + rng.gauss(0, w * 0.16)
        blade(d, rng, x0, h, rng.uniform(0.2, 0.5) * h, rng.uniform(3, 6), rng.uniform(-0.5, 0.5), rng.choice(BLADE))
    return im


if __name__ == "__main__":
    rng = random.Random(14402)
    grass(rng).save(OUT / "grass.webp", "WEBP", lossless=True)
    lawn(rng).save(OUT / "lawn.webp", "WEBP", quality=82)
    weeds(rng).save(OUT / "weeds.webp", "WEBP", lossless=True)
    print("vegetation: lawn.webp, grass.webp, weeds.webp")
