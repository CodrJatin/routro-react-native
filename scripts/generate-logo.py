"""MetroSync logo generator.

Design grid is 120 units square. A 45-degree route line runs corner to corner
and acts as the slash of an M/S monogram: M occupies the upper-left triangle,
S the lower-right, and both are cut by a clear band around the line.
"""
import os
from PIL import Image, ImageDraw, ImageFont

# The wordmark is built from the app's own typeface, so the logo and the UI
# share letterforms. Run from the repo root.
FONT = "node_modules/@expo-google-fonts/outfit/700Bold/Outfit_700Bold.ttf"

BG = (20, 19, 19)
FG = (229, 226, 225)
ACCENT = (237, 163, 60)

G = 120.0          # design grid
SS = 4             # supersample factor

# route line
L1, L2 = (20.0, 100.0), (100.0, 20.0)
LINE_W = 9.0
CUT_HALF = 9.5    # half-width of the band erased from the letterforms

# stations
TERM_OUT, TERM_IN = 19.0, 9.0
CENTER_SQ = 19.0

# letters
LETTER_H = 52.0
M_C = (44.0, 41.5)
S_C = (76.0, 78.5)


def glyph(ch, target_h, px):
    """Tight-cropped glyph bitmap scaled so its cap height is target_h px."""
    font = ImageFont.truetype(FONT, 400)
    tmp = Image.new("L", (900, 900), 0)
    ImageDraw.Draw(tmp).text((450, 450), ch, font=font, fill=255, anchor="mm")
    tmp = tmp.crop(tmp.getbbox())
    w, h = tmp.size
    new_h = max(1, int(round(target_h * px)))
    new_w = max(1, int(round(w * new_h / h)))
    return tmp.resize((new_w, new_h), Image.LANCZOS)


def render(size, accent=False, transparent=False, mono=False, inset=1.0):
    """inset < 1 shrinks the artwork for Android adaptive-icon safe zones."""
    px = size * SS / G
    S = size * SS

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0) if transparent else BG + (255,))

    fg = (255, 255, 255) if mono else FG
    line_col = ACCENT if (accent and not mono) else fg

    def P(x, y):
        """Design units -> pixels, honouring the inset scale about the centre."""
        return ((x - 60) * inset + 60) * px, ((y - 60) * inset + 60) * px

    # --- letterforms, cut by a clear band along the route line ---
    letters = Image.new("L", (S, S), 0)
    for ch, (cx, cy) in (("M", M_C), ("S", S_C)):
        g = glyph(ch, LETTER_H * inset, px)
        ox, oy = P(cx, cy)
        letters.paste(g, (int(ox - g.width / 2), int(oy - g.height / 2)), g)

    cut = Image.new("L", (S, S), 255)
    ImageDraw.Draw(cut).line([P(*L1), P(*L2)], fill=0,
                             width=int(round(2 * CUT_HALF * inset * px)))
    letters = Image.composite(letters, Image.new("L", (S, S), 0), cut)
    img.paste(Image.new("RGBA", (S, S), fg + (255,)), (0, 0), letters)

    d = ImageDraw.Draw(img)

    # --- route line ---
    d.line([P(*L1), P(*L2)], fill=line_col + (255,),
           width=int(round(LINE_W * inset * px)))

    # --- stations: hollow squares at the terminals, solid at the interchange ---
    for cx, cy in (L1, L2):
        ox, oy = P(cx, cy)
        h = TERM_OUT * inset * px / 2
        d.rectangle([ox - h, oy - h, ox + h, oy + h], fill=line_col + (255,))
        h = TERM_IN * inset * px / 2
        inner = (0, 0, 0, 0) if transparent else BG + (255,)
        d.rectangle([ox - h, oy - h, ox + h, oy + h], fill=inner)

    ox, oy = P(60, 60)
    h = CENTER_SQ * inset * px / 2
    d.rectangle([ox - h, oy - h, ox + h, oy + h], fill=line_col + (255,))

    return img.resize((size, size), Image.LANCZOS)


def emit(dest, accent):
    """Write the full Expo asset set. Android adaptive icons crop to roughly
    the centre 66%, so the foreground layers are inset to stay inside it."""
    os.makedirs(dest, exist_ok=True)
    w = lambda img, name: img.save(os.path.join(dest, name))

    w(render(1024, accent=accent), "icon.png")
    w(render(1024, accent=accent, transparent=True), "splash-icon.png")
    w(render(1024, accent=accent, transparent=True, inset=0.62),
      "android-icon-foreground.png")
    w(render(1024, mono=True, transparent=True, inset=0.62),
      "android-icon-monochrome.png")
    w(Image.new("RGB", (1024, 1024), BG), "android-icon-background.png")
    w(render(64, accent=accent), "favicon.png")


if __name__ == "__main__":
    out = os.environ.get("OUT", ".")
    os.makedirs(out, exist_ok=True)

    # contact sheet for review
    sheet = Image.new("RGB", (900, 500), (40, 40, 40))
    sheet.paste(render(360), (30, 30))
    sheet.paste(render(360, accent=True), (450, 30))
    for i, s in enumerate((96, 64, 44)):
        sheet.paste(render(s), (30 + i * 120, 410))
        sheet.paste(render(s, accent=True), (450 + i * 120, 410))
    sheet.save(os.path.join(out, "sheet.png"))

    emit(os.path.join(out, "accent"), accent=True)
    emit(os.path.join(out, "mono"), accent=False)
    print("wrote sheet.png + accent/ + mono/ to " + out)
