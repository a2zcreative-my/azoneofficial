"""v1.381.0 - print-ready QR codes for the two public forms (the CEO, 18-11-2026: trust).

    python3 scripts/make-form-qr.py          # writes public/qr/*.png and *.svg

Each form gets: <name>-qr.svg (the code alone, vector, for print), <name>-qr.png
(the code alone, 1200 px) and <name>-card.png (1080 x 1350: title, code, the
short address printed under it, the registered company). The code points at the
SHORT link (a2zcreative.my/partner, /business - public/_redirects), so a printed
card keeps working if the form ever moves. Error correction H; the logo covers
under 7% of the code, well inside what H recovers. Brand navy #1a2946 / gold #c9a227."""
import base64, io, os, sys
import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "qr")
NAVY, GOLD, WHITE, MUTED = (26, 41, 70), (201, 162, 39), (255, 255, 255), (90, 102, 125)
FONTS = ["/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"]
FONTS_REG = ["/usr/share/fonts/truetype/google-fonts/Poppins-Regular.ttf", "C:/Windows/Fonts/arial.ttf"]
FORMS = [
    ("partner", "https://a2zcreative.my/partner", "a2zcreative.my/partner", "Become an A2Z Partner", "Jadi Rakan Kongsi A2Z", "Partner Interest Application · Permohonan Minat Rakan Kongsi"),
    ("business", "https://a2zcreative.my/business", "a2zcreative.my/business", "Free Business Growth Check", "Semakan Pertumbuhan Bisnes Percuma", "A free first review · Semakan awal percuma"),
]
COMPANY = "A2Z CREATIVE MARKETING · SSM 202603003468 (CA0414729-A)"

def font(paths, size):
    for p in paths:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def matrix(url):
    q = qrcode.QRCode(error_correction=ERROR_CORRECT_H, border=4, box_size=1)
    q.add_data(url); q.make(fit=True)
    return q.get_matrix()

def logo_tile(px):
    """the A2Z mark on a white rounded tile, px wide"""
    logo = Image.open(os.path.join(ROOT, "public", "logo.png")).convert("RGBA")
    tile = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile); d.rounded_rectangle([0, 0, px - 1, px - 1], radius=px // 6, fill=WHITE)
    w = int(px * 0.78); h = int(logo.height * w / logo.width)
    tile.alpha_composite(logo.resize((w, h), Image.LANCZOS), ((px - w) // 2, (px - h) // 2))
    return tile

def qr_png(url, size):
    m = matrix(url); n = len(m); cell = size // n; size = cell * n
    img = Image.new("RGBA", (size, size), WHITE + (255,)); d = ImageDraw.Draw(img)
    for y, row in enumerate(m):
        for x, v in enumerate(row):
            if v: d.rectangle([x * cell, y * cell, (x + 1) * cell - 1, (y + 1) * cell - 1], fill=NAVY)
    t = int(size * 0.24); img.alpha_composite(logo_tile(t), ((size - t) // 2, (size - t) // 2))
    return img

def qr_svg(url):
    m = matrix(url); n = len(m)
    rects = "".join(f'<rect x="{x}" y="{y}" width="1" height="1"/>' for y, row in enumerate(m) for x, v in enumerate(row) if v)
    buf = io.BytesIO(); logo_tile(480).save(buf, "PNG"); b64 = base64.b64encode(buf.getvalue()).decode()
    t = n * 0.24; o = (n - t) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" shape-rendering="crispEdges">'
            f'<rect width="{n}" height="{n}" fill="#ffffff"/><g fill="#1a2946">{rects}</g>'
            f'<image href="data:image/png;base64,{b64}" x="{o}" y="{o}" width="{t}" height="{t}"/></svg>')

def centred(d, y, text, f, fill, W):
    w = d.textlength(text, font=f); d.text(((W - w) / 2, y), text, font=f, fill=fill)

def card(name, url, short, en, ms, sub):
    W, H = 1080, 1350
    img = Image.new("RGBA", (W, H), WHITE + (255,)); d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 210], fill=NAVY); d.rectangle([0, 210, W, 222], fill=GOLD)
    centred(d, 62, en, font(FONTS, 58), WHITE, W)
    centred(d, 140, ms, font(FONTS_REG, 34), (226, 232, 240), W)
    q = qr_png(url, 700); img.alpha_composite(q, ((W - q.width) // 2, 290))
    y = 290 + q.height + 40
    centred(d, y, "Scan or visit · Imbas atau layari", font(FONTS_REG, 30), MUTED, W)
    centred(d, y + 50, short, font(FONTS, 54), NAVY, W)
    d.rectangle([W // 2 - 60, y + 135, W // 2 + 60, y + 141], fill=GOLD)
    centred(d, y + 165, sub, font(FONTS_REG, 26), MUTED, W)
    centred(d, H - 70, COMPANY, font(FONTS_REG, 24), MUTED, W)
    return img.convert("RGB")

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, url, short, en, ms, sub in FORMS:
        qr_png(url, 1200).convert("RGB").save(os.path.join(OUT, f"{name}-qr.png"), optimize=True)
        open(os.path.join(OUT, f"{name}-qr.svg"), "w", encoding="utf-8").write(qr_svg(url))
        card(name, url, short, en, ms, sub).save(os.path.join(OUT, f"{name}-card.png"), optimize=True)
        print("wrote", name)
    sys.exit(0)
