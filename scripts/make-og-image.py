#!/usr/bin/env python3
"""
OG Image generator — 1200×630px
Clean, professional, minimal. Used for WhatsApp/Facebook/Twitter link previews.
"""
import os, sys, math, urllib.request, subprocess

for pkg in ["Pillow", "python-bidi"]:
    subprocess.run([sys.executable, "-m", "pip", "install", pkg, "-q"],
                   capture_output=True, check=False)

from PIL import Image, ImageDraw, ImageFont, ImageFilter
from bidi.algorithm import get_display

FONTS_DIR = r"C:\Users\robi_\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\94703527-7ff0-4396-812f-df4ff7b3f1d0\62fa1767-6d37-40fc-933e-84008250de7b\skills\canvas-design\canvas-fonts"
OUT = r"C:\leads\public\og-image.jpg"
W, H = 1200, 630

# Palette
NAVY     = (8, 12, 38)
MID_BLUE = (11, 35, 110)
ELEC     = (13, 62, 251)
TEAL     = (0, 160, 210)
WHITE    = (255, 255, 255)
SOFT     = (170, 200, 255)
DIM      = (110, 140, 200)

def lerp(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

def _try(path, size):
    if os.path.exists(path):
        try: return ImageFont.truetype(path, size)
        except: pass
    return None

def hebrew_font(size, bold=True):
    sfx = "Bold" if bold else "Regular"
    hp = os.path.join(FONTS_DIR, f"Heebo-{sfx}.ttf")
    if not os.path.exists(hp):
        try:
            url = f"https://raw.githubusercontent.com/google/fonts/main/ofl/heebo/static/Heebo-{sfx}.ttf"
            urllib.request.urlretrieve(url, hp)
        except: pass
    for p in [hp,
              rf"C:\Windows\Fonts\arial{'bd' if bold else ''}.ttf",
              rf"C:\Windows\Fonts\calibri{'b' if bold else ''}.ttf"]:
        f = _try(p, size)
        if f: return f
    return ImageFont.load_default()

def latin_font(name, size):
    return _try(os.path.join(FONTS_DIR, name), size) or ImageFont.load_default()

def rtl(text):
    return get_display(text)

def make():
    img = Image.new("RGB", (W, H), NAVY)
    d   = ImageDraw.Draw(img)

    # ── Background gradient (left navy → right deep blue) ──────────
    for x in range(W):
        t = x / W
        c = lerp(NAVY, MID_BLUE, t)
        d.line([(x, 0), (x, H)], fill=c)

    # ── Electric glow — bottom-left ─────────────────────────────────
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd   = ImageDraw.Draw(glow)
    for r in range(320, 4, -8):
        a = int(45 * (1 - r / 320) ** 2)
        gd.ellipse([-r, H - r, r, H + r], fill=(*ELEC, a))
    glow = glow.filter(ImageFilter.GaussianBlur(30))
    img.paste(Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB"))

    # ── Subtle horizontal rule + dots motif ─────────────────────────
    d = ImageDraw.Draw(img)
    # Top thin line
    d.line([(60, 48), (W - 60, 48)], fill=(*ELEC, 60), width=1)
    # Bottom thin line
    d.line([(60, H - 48), (W - 60, H - 48)], fill=(*ELEC, 40), width=1)

    # ── Left accent bar ──────────────────────────────────────────────
    bar_x = 60
    d.rectangle([bar_x, 110, bar_x + 4, H - 110], fill=ELEC)

    # ── Wave lines — right side subtle ──────────────────────────────
    for i in range(5):
        wy = 200 + i * 55
        pts = [(x, wy + int(6 * math.sin(x * 0.018 + i))) for x in range(W // 2, W - 40, 4)]
        a = max(8, 35 - i * 5)
        d2 = ImageDraw.Draw(img)
        d2.line(pts, fill=lerp(TEAL, NAVY, 0.3 + i * 0.1), width=1)

    # ── Eyebrow tag ─────────────────────────────────────────────────
    jura = latin_font("Jura-Light.ttf", 18)
    tag  = rtl("שווי דירה נתניה  ·  NETANYA REAL ESTATE  ·  2026")
    bb   = d.textbbox((0, 0), tag, font=jura)
    d.text((90, 72), tag, font=jura, fill=SOFT)

    # ── Main headline ────────────────────────────────────────────────
    hl_text = rtl("כמה שווה הדירה שלך בנתניה?")
    hl_font = hebrew_font(88, bold=True)
    bb = d.textbbox((0, 0), hl_text, font=hl_font)
    hl_w = bb[2] - bb[0]
    # If too wide, shrink
    sz = 88
    while hl_w > W - 160 and sz > 48:
        sz -= 4
        hl_font = hebrew_font(sz, bold=True)
        bb = d.textbbox((0, 0), hl_text, font=hl_font)
        hl_w = bb[2] - bb[0]

    hl_x = (W - hl_w) // 2
    hl_y = 150
    # Shadow
    d.text((hl_x + 3, hl_y + 3), hl_text, font=hl_font, fill=(0, 5, 20))
    # Text
    d.text((hl_x, hl_y), hl_text, font=hl_font, fill=WHITE)

    # ── Sub-line ─────────────────────────────────────────────────────
    sub_text = rtl("דוח שווי מיידי לפי עסקאות אמיתיות — בחינם ומיידי")
    sub_font = hebrew_font(34, bold=False)
    bb = d.textbbox((0, 0), sub_text, font=sub_font)
    sw = bb[2] - bb[0]
    sz = 34
    while sw > W - 160 and sz > 20:
        sz -= 2
        sub_font = hebrew_font(sz, bold=False)
        bb = d.textbbox((0, 0), sub_text, font=sub_font)
        sw = bb[2] - bb[0]
    d.text(((W - sw) // 2, hl_y + (bb[3] - bb[1]) + 88 + 16), sub_text, font=sub_font, fill=SOFT)

    # ── 3 trust pills ────────────────────────────────────────────────
    pill_font = hebrew_font(22, bold=False)
    pills = [
        rtl("עסקאות אמיתיות"),
        rtl("תוצאה תוך 30 שניות"),
        rtl("19 שכונות בנתניה"),
    ]
    pill_y = H - 125
    total_pill_w = 0
    pill_dims = []
    for p in pills:
        bb = d.textbbox((0, 0), p, font=pill_font)
        pw = bb[2] - bb[0]
        ph = bb[3] - bb[1]
        pill_dims.append((pw, ph))
        total_pill_w += pw + 40 + 24  # padding + gap

    pill_start_x = (W - total_pill_w + 24) // 2
    cx = pill_start_x
    for i, (p, (pw, ph)) in enumerate(zip(pills, pill_dims)):
        px0 = cx
        px1 = cx + pw + 40
        py0 = pill_y
        py1 = pill_y + ph + 16
        # Pill background
        d.rounded_rectangle([px0, py0, px1, py1], radius=(py1 - py0) // 2,
                             fill=(255, 255, 255, 0), outline=(*ELEC, 160), width=1)
        # Actually fill with semi-transparent look (no real RGBA on RGB image, use dark blue)
        d.rounded_rectangle([px0, py0, px1, py1], radius=(py1 - py0) // 2,
                             fill=lerp(NAVY, ELEC, 0.15), outline=ELEC, width=1)
        d.text((cx + 20, pill_y + 8), p, font=pill_font, fill=WHITE)
        cx += pw + 40 + 24

    # ── Bottom domain strip ──────────────────────────────────────────
    domain_font = latin_font("Jura-Light.ttf", 16) or hebrew_font(16, bold=False)
    domain_text = "shaviut-netanya.co.il"
    bb = d.textbbox((0, 0), domain_text, font=domain_font)
    dw = bb[2] - bb[0]
    d.text((W - dw - 64, H - 40), domain_text, font=domain_font, fill=DIM)

    img.save(OUT, "JPEG", quality=92, optimize=True)
    print(f"Saved: {OUT}  ({W}x{H})")

make()
