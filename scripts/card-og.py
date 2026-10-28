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

v1.218.0 - THE BILINGUAL RECORDS, AND THE CARD IMAGE
Since v1.128.0 the records carry `known` and `role` as {en, ms} pairs, and
this script still looked for a single string, so it matched no record and
could not run: the preview images kept the titles of 30 August (Izz showed
"Director / CCO"). It now reads the pairs and prints the Malay title, which
is what the card opens in. It also draws a portrait business-card image,
<slug>-card.png (1080 x 1350), for "Download image" in the portal.

THE QR IS NEVER REWRITTEN. QR codes are printed on paper; an existing
<slug>-qr.png is left exactly as it is. Only a missing one is drawn (that
needs `pip install qrcode`).

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
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Missing dependency. Run:  pip install pillow")

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
    """Each record of constants/team.ts: slug, name, known (ms), role (ms),
    monogram, photo, mobile, email - read from the bilingual shape."""
    src = open(os.path.join(ROOT, "constants", "team.ts"), encoding="utf-8").read()
    out = []
    for m in re.finditer(r'\{\s*slug:\s*"([a-z0-9-]+)",\s*name:\s*"([^"]+)",', src):
        block = src[m.start(): src.find("\n  },", m.start())]
        def pair(field):
            f = re.search(field + r':\s*\{\s*en:\s*"([^"]+)",\s*ms:\s*"([^"]+)"\s*\}', block)
            if not f:
                sys.exit("%s: could not read %s in constants/team.ts" % (m.group(1), field))
            return f.group(2)
        def one(field):
            f = re.search(field + r':\s*"([^"]*)",', block)
            if not f:
                sys.exit("%s: could not read %s in constants/team.ts" % (m.group(1), field))
            return f.group(1)
        out.append((m.group(1), m.group(2), pair("known"), pair("role"), one("monogram"), one("photo"), one("mobile"), one("email")))
    if not out:
        sys.exit("Could not parse constants/team.ts - has the record shape changed?")
    return out


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


def build(slug, name, known, role, mono, photo, mobile, email):
    url = "https://a2zcreative.my/%s" % slug

    # ---- QR: 900 px. Printed on paper, so an existing file is NEVER redrawn.
    qr_path = os.path.join(OUT, "%s-qr.png" % slug)
    if not os.path.exists(qr_path):
        try:
            import qrcode
        except ImportError:
            sys.exit("%s has no QR yet. Run:  pip install qrcode" % slug)
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=20, border=2)
        qr.add_data(url)
        qr.make(fit=True)
        qr.make_image(fill_color=NAVY, back_color=WHITE).convert("RGB").resize(
            (900, 900), Image.NEAREST
        ).save(qr_path, optimize=True)

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
    card_image(slug, name, known, role, mono, photo, mobile, email, qr_path)


def fit_lines(d, text, f, width):
    lines, cur = [], ""
    for word in text.split():
        t = (cur + " " + word).strip()
        if d.textlength(t, font=f) > width and cur:
            lines.append(cur)
            cur = word
        else:
            cur = t
    lines.append(cur)
    return lines


def centred(d, y, text, f, fill, W):
    d.text(((W - d.textlength(text, font=f)) / 2, y), text, font=f, fill=fill)


def card_image(slug, name, known, role, mono, photo, mobile, email, qr_path):
    """v1.218.0 - the business card as one portrait picture (1080 x 1350, the
    size a phone shows whole): the navy face, then the printed contact lines
    and the QR. Only fields from constants/team.ts - nothing else."""
    W, H = 1080, 1350
    im = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(im)
    top = 760
    d.rectangle([0, 0, W, top], fill=NAVY)
    d.rectangle([0, top - 8, W, top], fill=GOLD)
    logo_p = os.path.join(PUBLIC, "logo-white.png")
    if os.path.exists(logo_p):
        logo = Image.open(logo_p).convert("RGBA")
        lw = 200
        logo = logo.resize((lw, int(logo.size[1] * lw / logo.size[0])), Image.LANCZOS)
        im.paste(logo, ((W - lw) // 2, 56), logo)
    r = 140
    cx, cy = W // 2, 390
    if photo:
        p = os.path.join(PUBLIC, photo.lstrip("/").replace("/", os.sep))
        face = circle_photo(p, r * 2)
        im.paste(face, (cx - r, cy - r), face)
    else:
        f = font("bold", 96)
        bb = d.textbbox((0, 0), mono, font=f)
        d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]), mono, font=f, fill=GOLD)
    d.ellipse([cx - r - 4, cy - r - 4, cx + r + 4, cy + r + 4], outline=GOLD, width=6)
    y = cy + r + 40
    for ln in fit_lines(d, name, font("bold", 64), W - 140):
        centred(d, y, ln, font("bold", 64), CREAM, W)
        y += 76
    centred(d, y + 6, role, font("medium", 36), GOLD, W)
    centred(d, y + 58, "A2Z Creative Marketing", font("light", 30), WHITE, W)

    # the contact lines, as printed, and the QR
    x = 90
    d.text((x, top + 70), "Telefon", font=font("medium", 26), fill=GOLD)
    d.text((x, top + 104), mobile, font=font("bold", 40), fill=NAVY)
    d.text((x, top + 190), "E-mel", font=font("medium", 26), fill=GOLD)
    f_mail = font("medium", 32)
    while d.textlength(email, font=f_mail) > 560 and f_mail.size > 22:
        f_mail = font("medium", f_mail.size - 2)
    d.text((x, top + 224), email, font=f_mail, fill=NAVY)
    d.text((x, top + 310), "Kad digital", font=font("medium", 26), fill=GOLD)
    d.text((x, top + 344), "a2zcreative.my/%s" % slug, font=font("bold", 34), fill=NAVY)
    if os.path.exists(qr_path):
        q = Image.open(qr_path).convert("RGB").resize((330, 330), Image.NEAREST)
        im.paste(q, (W - 90 - 330, top + 80))
    d.text((x, H - 70), "Creative . Digital . Commerce.", font=font("light", 24), fill=NAVY)
    im.save(os.path.join(OUT, "%s-card.png" % slug), optimize=True)


if __name__ == "__main__":
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    for card in people():
        build(*card)
        print("  wrote public/cards/%s-og.png and %s-card.png (QR left as it is)" % (card[0], card[0]))
    print("\nNow run:  node tests/business-cards.mjs")
