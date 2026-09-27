#!/usr/bin/env python3
"""
Generate LifeDots' toolbar icons.

The icon *is* today's dot: hollow in the morning, filling as real minutes land,
solid once the day is done. That means the icon set is a product feature, not
decoration — so it is generated from this script rather than hand-drawn, and can
be regenerated when the fill states change.

    python3 tools/make-icons.py

Writes public/icons/dot-{0,25,50,75,100}-{16,32,48,128}.png
"""

from pathlib import Path
from PIL import Image, ImageDraw

# The toolbar icon is *today's* dot, and in the design language today is always
# the orange-ringed one — so orange is the semantically correct colour here, not
# a compromise. It is also the only one of our palette that survives both a light
# and a dark toolbar: ink (#16150F) disappears entirely against Chrome's dark
# chrome (#202124), which made the "solid = you did the work" state invisible for
# every dark-theme user. Verified at true 16px before changing.
DOT = (224, 123, 44, 255)        # --ideate / accent
SIZES = (16, 32, 48, 128)
STATES = (0, 25, 50, 75, 100)
SS = 8                            # supersample factor, for clean edges at 16px

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def make_icon(size: int, percent: int) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = s * 0.08
    box = (pad, pad, s - pad, s - pad)
    stroke = max(2, int(s * 0.10))

    # The ring is always there — an empty day is still a day that exists.
    draw.ellipse(box, outline=DOT, width=stroke)

    if percent > 0:
        # Fill rises from the bottom, clipped to the circle.
        disc = Image.new("L", (s, s), 0)
        ImageDraw.Draw(disc).ellipse(box, fill=255)

        level = Image.new("L", (s, s), 0)
        top = (s - pad) - (s - 2 * pad) * (percent / 100)
        ImageDraw.Draw(level).rectangle((0, top, s, s), fill=255)

        mask = Image.new("L", (s, s), 0)
        mask.paste(disc, (0, 0), level)

        ink = Image.new("RGBA", (s, s), DOT)
        img.paste(ink, (0, 0), mask)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    written = 0
    for percent in STATES:
        for size in SIZES:
            path = OUT / f"dot-{percent}-{size}.png"
            make_icon(size, percent).save(path, "PNG", optimize=True)
            written += 1
    print(f"wrote {written} icons to {OUT}")


if __name__ == "__main__":
    main()
