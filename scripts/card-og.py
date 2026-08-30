"""
card-og.py (v1.71.0) - regenerate the business-card assets in public/cards/.

  python scripts/card-og.py            # QR + Open Graph image for every card
  pip install qrcode pillow            # the only two dependencies

WHY A SCRIPT AND NOT A BUILD STEP
The Open Graph image and the QR change only when a person, a role or a slug
changes - which is roughly never. Generating them on every build would put a
Python dependency into the Cloudflare build container for no gain, and would
make a deploy fail for a reason that has nothing to do with the deploy. So
these are committed assets, and this is how they are rebuilt.

Run it after editing constants/team.ts, then run the guard:

  python scripts/card-og.py
  node tests/business-cards.mjs --write     # rebuilds the .vcf files
  node tests/business-cards.mjs             # checks everything agrees

THE PHOTO
If a card has `photo` set in constants/team.ts (a path under public/, e.g.
"/cards/farhan.jpg") it is cropped to a circle and used on the Open Graph
image, so forwarding the link in WhatsApp shows the person's face. With no
photo the two-letter monogram is drawn instead - which is the same fallback
the page itself uses, so the page and the preview never disagree.
"""

import os
import re
import sys

try:
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Missing dependencies. Run:  pip install qrcode pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
OUT = os.path.join(PUBLIC, "cards")

# Brand tokens, straight from styles/globals.css. Keep them in step.
NAVY = (26, 41, 70)      # --brand-primary  #1a2946
GOLD = (200, 169, 106)   # --brand-accent   #c8a96a
CREAM = (246, 242, 234)
WHITE = (255, 255, 255)

# Poppins is the site typeface (app/layout.tsx). Windows installs it into the
# user font directory; Linux CI images keep it under google-fonts. The last
# entry is a legibility fallback so this script never simply dies - it says
# which font it used instead.
FONT_DIRS = [
    os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Windows\Fonts"),
    r"C:\Windows\Fonts",
    "/usr/share/fonts/truetype/google-fonts",
    "/usr/share/fonts/truetype/dejavu",
]
FONT_FILES = {
    "bold": ["Poppins-Bold.ttf", "DejaVuSans-Bold.ttf", "arialbd.ttf"],
    "medium": ["Poppins-Medium.ttf", "DejaVuSans.ttf", "arial.ttf"],
    "light": ["Poppins-Light.ttf", "DejaVuSans.ttf", "arial.ttf"],
}
_reported = set()


def font(weight, size):
    for name in FONT_FILES[weight]:
        for d in FONT_DIRS:
            p = os.path.join(d, name)
            if os.path.exists(p):
                if name not in _reported and not name.startswith("Poppins"):
                    print("  ! Poppins not found, falling back to %s" % name)
                    _reported.add(name)
                return ImageFont.truetype(p, size)
    sys.exit("No usable font found. Install Poppins, or edit FONT_DIRS above.")


def people():
    src = open(os.path.join(ROOT, "constants", "team.ts"), encoding="utf-8").read()
    found = re.findall(
        r'\{\s*slug:\s*"([a-z0-9-]+)",\s*name:\s*"([^"]+)",\s*known:\s*"([^"]+)",'
        r'\s*role:\s*"([^"]+)"[\s\S]*?monogram:\s*"([^"]*)",\s*photo:\s*"([^"]*)",',
        src,
    )
    if not found:
        sys.exit("Could not parse constants/team.ts - has the record shape changed?")
    return found


def circle_photo(path, size):
    """Square-crop from the centre, resize, and mask to a circle."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
    im = im.resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size * 4, size * 4], fill=255)
    im.putalpha(mask.resize((size, size), Image.LANCZOS))
    return im


def build(slug, name, known, role, mono, photo):
    url = "https://a2zcreative.my/%s" % slug

    # ---- QR: 900 px, so the same file serves the page and the print artwork
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=20, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    qr.make_image(fill_color=NAVY, back_color=WHITE).convert("RGB").resize(
        (900, 900), Image.NEAREST
    ).save(os.path.join(OUT, "%s-qr.png" % slug), optimize=True)

    # ---- Open Graph: 1200x630, the size every messenger crops to
    W, H = 1200, 630
    og = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(og)
    d.rectangle([0, 0, 10, H], fill=GOLD)          # the gold edge off the printed card

    cx, cy, r = 150, 315, 78
    if photo:
        p = os.path.join(PUBLIC, photo.lstrip("/").replace("/", os.sep))
        if not os.path.exists(p):
            sys.exit("%s: photo %s is set in constants/team.ts but not in public/" % (slug, photo))
        face = circle_photo(p, r * 2)
        og.paste(face, (cx - r, cy - r), face)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=GOLD, width=3)
    else:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=GOLD, width=3)
        f = font("bold", 56)
        bb = d.textbbox((0, 0), mono, font=f)
        d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]),
               mono, font=f, fill=GOLD)

    x = 280
    d.text((x, 150), "A2Z CREATIVE MARKETING", font=font("medium", 22), fill=GOLD)

    f_name = font("bold", 60)
    lines, cur = [], ""
    for word in name.split():
        t = (cur + " " + word).strip()
        if d.textlength(t, font=f_name) > W - x - 70 and cur:
            lines.append(cur)
            cur = word
        else:
            cur = t
    lines.append(cur)
    y = 215
    for ln in lines:
        d.text((x, y), ln, font=f_name, fill=CREAM)
        y += 76

    y += 10
    d.text((x, y), role, font=font("medium", 30), fill=GOLD)
    d.text((x, y + 52), known, font=font("light", 26), fill=WHITE)
    d.text((x, H - 90), "a2zcreative.my/%s" % slug, font=font("medium", 26), fill=WHITE)
    og.save(os.path.join(OUT, "%s-og.png" % slug), optimize=True)


if __name__ == "__main__":
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    for card in people():
        build(*card)
        print("  wrote public/cards/%s-og.png and %s-qr.png" % (card[0], card[0]))
    print("\nNow run:  node tests/business-cards.mjs")
