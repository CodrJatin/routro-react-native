"""Renders every Routro logo asset from one set of numbers.

The mark is a diamond with a bar threaded through its waist, the bar running
behind the diamond at both side points so it reads as passing through rather
than sitting on top.

Nothing is cut to achieve that. The diamond is a single closed path and the bar
is a single unbroken band; the depth comes purely from paint order:

    1. the bar, full width   <- behind
    2. the diamond           <- covers the bar at both side points

So the bar shows through the diamond's hollow middle, is interrupted by each
side point, and emerges at both ends.

The one constraint that fixes the proportions: a mitred corner on a 90-degree
vertex sticks out by (stroke / 2) * sqrt(2) along the bisector, so the diamond's
side points are RING_W * sqrt(2) tall. BAR_W has to clear that, or a point
breaks out through the bar's edges instead of being contained by it and the
threading reads as a plain crossing. Hence a bar noticeably heavier than the
ring -- that is a requirement, not a style choice.

    python scripts/generate-logo.py
"""

from __future__ import annotations

import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

# --- geometry, on a 100-unit grid ------------------------------------------

GRID = 100.0
CX = CY = 50.0

R = 30.0        # diamond half-diagonal, centre to point
RING_W = 8.0    # diamond stroke
BAR_W = 15.0    # bar stroke; must exceed RING_W * sqrt(2) = 11.31 with margin
BAR_X0 = 2.0    # bar runs nearly edge to edge so it reads as passing through
BAR_X1 = 98.0

# A mitred 90-degree corner extends this far past the vertex.
MITRE = RING_W / 2 * math.sqrt(2)
R_OUT = R + MITRE
R_IN = R - MITRE

MARK_W = BAR_X1 - BAR_X0
# Farthest drawn point from centre: the corner of a bar end, not the bounding
# box corner. Sizes the Android foreground against the adaptive-icon safe circle.
MARK_RADIUS = math.hypot(MARK_W / 2, BAR_W / 2)

# --- palette ---------------------------------------------------------------

INK = (229, 226, 225)      # onSurface, dark theme
ACCENT = (61, 214, 140)    # success -- the app's only saturated colour
CANVAS = (20, 19, 19)      # surface, dark theme
WHITE = (255, 255, 255)

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "assets" / "logo"
ASSETS = ROOT / "assets"

SS = 4  # supersampling factor; 45-degree edges need it


def diamond(cx: float, cy: float, r: float) -> list[tuple[float, float]]:
    return [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]


def render(size: int, frac: float, ink, accent, bg=None) -> Image.Image:
    """Draws the mark `frac` of `size` wide. `bg=None` leaves it transparent."""
    s = frac * size / MARK_W
    px = size * SS

    def pt(x: float, y: float) -> tuple[float, float]:
        return ((size / 2 + (x - CX) * s) * SS, (size / 2 + (y - CY) * s) * SS)

    def bar_mask() -> Image.Image:
        m = Image.new("L", (px, px), 0)
        d = ImageDraw.Draw(m)
        d.polygon(
            [
                pt(BAR_X0, CY - BAR_W / 2),
                pt(BAR_X1, CY - BAR_W / 2),
                pt(BAR_X1, CY + BAR_W / 2),
                pt(BAR_X0, CY + BAR_W / 2),
            ],
            fill=255,
        )
        return m.resize((size, size), Image.LANCZOS)

    def ring_mask() -> Image.Image:
        m = Image.new("L", (px, px), 0)
        d = ImageDraw.Draw(m)
        d.polygon([pt(x, y) for x, y in diamond(CX, CY, R_OUT)], fill=255)
        d.polygon([pt(x, y) for x, y in diamond(CX, CY, R_IN)], fill=0)
        return m.resize((size, size), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (bg or (0, 0, 0)) + (255 if bg else 0,))
    for mask, colour in ((bar_mask(), accent), (ring_mask(), ink)):
        layer = Image.new("RGBA", (size, size), colour + (255,))
        layer.putalpha(mask)
        canvas.alpha_composite(layer)
    return canvas


def hexof(c) -> str:
    return "#%02x%02x%02x" % c


def paths(ink: str, accent: str) -> str:
    """The two paints, in order, as SVG on the 100-unit grid."""
    d = diamond(CX, CY, R)
    ring = "M{:g} {:g}L{:g} {:g}L{:g} {:g}L{:g} {:g}Z".format(*[v for p in d for v in p])
    return (
        f'  <path d="M{BAR_X0:g} {CY:g}H{BAR_X1:g}" stroke="{accent}" stroke-width="{BAR_W:g}"/>\n'
        f'  <path d="{ring}" stroke="{ink}" stroke-width="{RING_W:g}" stroke-linejoin="miter"/>\n'
    )


def svg(size: int, frac: float, ink: str, accent: str, bg: str | None) -> str:
    s = frac * size / MARK_W
    off = size / 2 - CX * s
    plate = f'  <rect width="{size}" height="{size}" fill="{bg}"/>\n' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}" fill="none">\n'
        f"{plate}"
        f'  <g transform="translate({off:.4g} {off:.4g}) scale({s:.4g})" fill="none">\n'
        + "".join("  " + line + "\n" for line in paths(ink, accent).splitlines())
        + "  </g>\n</svg>\n"
    )


def main() -> None:
    LOGO.mkdir(parents=True, exist_ok=True)

    # The reference mark. currentColor lets the site invert it with the theme;
    # the bar takes an override so a page can swap the accent without a copy.
    (LOGO / "mark.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {GRID:g} {GRID:g}" fill="none">\n'
        + paths("currentColor", "var(--routro-accent, #3dd68c)")
        + "</svg>\n",
        encoding="utf-8",
    )

    (LOGO / "app-icon.svg").write_text(
        svg(1024, 0.66, hexof(INK), hexof(ACCENT), hexof(CANVAS)), encoding="utf-8"
    )
    # 0.55 keeps the bar ends inside the adaptive icon's 66/108 safe circle
    # (radius 313px of 1024) whatever mask the launcher applies.
    assert MARK_RADIUS * (0.55 * 1024 / MARK_W) < 313
    (LOGO / "android-foreground.svg").write_text(
        svg(1024, 0.55, hexof(INK), hexof(ACCENT), None), encoding="utf-8"
    )
    # Android tints this flat, so the depth cannot survive -- both paints go
    # white and the mark merges into a diamond crossed by a bar. Same file feeds
    # the notification icon via the expo-notifications plugin.
    (LOGO / "android-monochrome.svg").write_text(
        svg(1024, 0.55, "#ffffff", "#ffffff", None), encoding="utf-8"
    )

    png = {
        "icon.png": render(1024, 0.66, INK, ACCENT, CANVAS),
        "favicon.png": render(48, 0.72, INK, ACCENT, CANVAS),
        "splash-icon.png": render(512, 0.58, INK, ACCENT),
        "android-icon-foreground.png": render(1024, 0.55, INK, ACCENT),
        "android-icon-monochrome.png": render(1024, 0.55, WHITE, WHITE),
        "android-icon-background.png": Image.new("RGBA", (1024, 1024), CANVAS + (255,)),
    }
    for name, im in png.items():
        im.save(LOGO / name)
        shutil.copyfile(LOGO / name, ASSETS / name)
        print(f"{name:32} {im.size[0]}x{im.size[1]}")


if __name__ == "__main__":
    main()
