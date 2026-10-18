"""Generates every image the watchface uses into assets/bip6/, plus
watchface/metrics.js (glyph sizes and the computed date/weather row layout).

Run from the project root:  python3 tools/gen_assets.py
Needs Pillow and the fonts from tools/fetch_fonts.sh.

Digit sets are fixed-width so values don't jitter as they change; every glyph
in a set shares one height so mixed characters (digits, %, deg, :) line up.
Font sizes are the px sizes from the approved wireframe.
Icons come from Material Symbols Rounded (filled), supersampled 4x.
"""
import json
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'tools', 'fonts')
OUT = os.path.join(ROOT, 'assets', 'bip6')

BARLOW = {w: os.path.join(FONTS, f'BarlowCondensed-{w}.ttf') for w in ('Medium', 'SemiBold', 'Bold')}
SYMBOLS = os.path.join(FONTS, 'MaterialSymbolsRounded.ttf')

WHITE = '#ffffff'
AOD_GRAY = '#7a7a80'
ORANGE = '#ff8a1f'
STEPS = '#2ee6ff'
CAL = '#ff5a36'
STAND = '#b6f23a'
DIST = '#a98bff'
HR = '#ff3b5c'
SPO2 = '#4da3ff'
STRESS = '#ffb020'
HYBRID = '#3ee0b5'
SLEEP = '#8b7cff'
TEMP = '#ff8a3d'
HUMID = '#38bdf8'
GOOD = '#34d399'
WARN = '#ffb020'
BAD = '#ff4545'
TRACK = '#26262c'

SS = 4  # supersampling factor for icons and shapes

# Date/weather row: spans x 28..362, vertically centred on y 276
ROW_X0, ROW_X1, ROW_CY = 28, 362, 276

metrics = {}


def save(img, rel):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    return img


def tint(mask, color):
    img = Image.new('RGBA', mask.size, color)
    img.putalpha(mask)
    return img


# ---------- digit / text sets ----------

EXTRAS = {'colon': ':', 'dot': '.', 'slash': '/', 'pct': '%', 'deg': '°', 'minus': '-', 'invalid': '--'}


def font_set(name, size, color, extras=(), weight='SemiBold', pad_x=1):
    font = ImageFont.truetype(BARLOW[weight], size)
    probe = '0123456789%' + ('°' if 'deg' in extras else '')
    top = font.getbbox(probe, anchor='ls')[1]  # negative: distance above baseline
    h = -top + 1
    digit_w = max(math.ceil(font.getlength(c)) for c in '0123456789') + pad_x

    def glyph(text, w=None):
        w = w or math.ceil(font.getlength(text)) + pad_x
        mask = Image.new('L', (w, h), 0)
        tw = font.getlength(text)
        ImageDraw.Draw(mask).text(((w - tw) / 2, h - 1), text, font=font, fill=255, anchor='ls')
        return tint(mask, color)

    m = {'h': h, 'digit_w': digit_w}
    for d in '0123456789':
        save(glyph(d, digit_w), f'font/{name}/{d}.png')
    for key in extras:
        m[key] = save(glyph(EXTRAS[key]), f'font/{name}/{key}.png').width
    metrics[name] = m


def word_set(name, words, size, color, align='left'):
    """All images in a set share one width so neighbours can sit at fixed x."""
    font = ImageFont.truetype(BARLOW['Bold'], size)
    top = font.getbbox('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', anchor='ls')[1]
    h = -top + 1
    w = max(math.ceil(font.getlength(word)) for word in words) + 1
    for i, word in enumerate(words):
        mask = Image.new('L', (w, h), 0)
        tw = font.getlength(word)
        x = w - tw if align == 'right' else 0
        ImageDraw.Draw(mask).text((x, h - 1), word, font=font, fill=255, anchor='ls')
        save(tint(mask, color), f'date/{name}_{i}.png')
    metrics[name] = {'h': h, 'w': w}


WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']  # IMG_WEEK order: Monday first
MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']


# ---------- icons ----------

_codepoints = None


def codepoint(name):
    global _codepoints
    if _codepoints is None:
        with open(os.path.join(FONTS, 'MaterialSymbolsRounded.codepoints')) as f:
            _codepoints = dict(line.split() for line in f if line.strip())
    return chr(int(_codepoints[name], 16))


def symbol_mask(name, size, weight=500, fill=1):
    big = size * SS
    font = ImageFont.truetype(SYMBOLS, big)
    font.set_variation_by_axes([fill, 0, 48, weight])
    canvas = Image.new('L', (big * 2, big * 2), 0)
    ImageDraw.Draw(canvas).text((big, big), codepoint(name), font=font, fill=255, anchor='mm')
    # Material glyphs sit on a square em; crop that em around the visual centre.
    l, t, r, b = canvas.getbbox()
    cx, cy = (l + r) / 2, (t + b) / 2
    em = canvas.crop((int(cx - big / 2), int(cy - big / 2), int(cx + big / 2), int(cy + big / 2)))
    return em.resize((size, size), Image.LANCZOS)


def icon(rel, name, size, color, **kw):
    save(tint(symbol_mask(name, size, **kw), color), f'icon/{rel}.png')


def triangle(rel, size, color, up=True):
    big = size * SS
    img = Image.new('L', (big, big), 0)
    pts = [(big / 2, big * 0.15), (big * 0.92, big * 0.85), (big * 0.08, big * 0.85)]
    if not up:
        pts = [(x, big - y) for x, y in pts]
    ImageDraw.Draw(img).polygon(pts, fill=255)
    save(tint(img.resize((size, size), Image.LANCZOS), color), f'icon/{rel}.png')


# ---------- bars, overlays ----------

def bar_set(name, w, h, color_for, steps=10):
    """steps+1 images: 0 = empty track, steps = full. color_for(i) picks the fill."""
    for i in range(steps + 1):
        big = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
        d = ImageDraw.Draw(big)
        r = h * SS // 2
        d.rounded_rectangle((0, 0, w * SS - 1, h * SS - 1), r, fill=TRACK)
        if i:
            fw = max(h * SS, round(w * SS * i / steps))
            d.rounded_rectangle((0, 0, fw - 1, h * SS - 1), r, fill=color_for(i))
        save(big.resize((w, h), Image.LANCZOS), f'bar/{name}/{i}.png')


def press_overlay(rel, w, h, radius=14):
    save(Image.new('RGBA', (w, h), (0, 0, 0, 0)), f'press/{rel}.png')
    big = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * SS - 1, h * SS - 1), radius * SS, fill=(255, 255, 255, 46))
    save(big.resize((w, h), Image.LANCZOS), f'press/{rel}_press.png')


def app_icon(size=124):
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, big - 1, big - 1), fill='#000000')
    for i, color in enumerate((STEPS, CAL, STAND)):
        inset = (10 + i * 15) * SS
        d.arc((inset, inset, big - inset, big - inset), -90, 200 - i * 50, fill=color, width=11 * SS)
    img = img.resize((size, size), Image.LANCZOS)
    img.alpha_composite(tint(symbol_mask('ecg_heart', 40), HR), ((size - 40) // 2, (size - 40) // 2))
    img.save(os.path.join(OUT, 'icon.png'))


# ---------- date/weather row layout ----------

def date_row():
    """Lays the row out like the wireframe's flex `space-between`: four groups
    (date, temp, high/low, humidity) with equal gaps, sized for two-digit values."""
    r, wk, mo = metrics['row'], metrics['week'], metrics['month']
    dw = r['digit_w']
    ICON, TRI = 20, 11
    groups = {
        'date': wk['w'] + 5 + 2 * dw + 5 + mo['w'],
        'temp': ICON + 2 + 2 * dw + r['deg'],
        'hilo': 2 * (TRI + 2 + 2 * dw + r['deg']) + 6,
        'hum': ICON + 2 + 2 * dw + r['pct'],
    }
    gap = (ROW_X1 - ROW_X0 - sum(groups.values())) / 3
    assert gap >= 6, f'date row does not fit (gap {gap:.1f}px)'
    x, pos = ROW_X0, {}
    for k, w in groups.items():
        pos[k] = round(x)
        x += w + gap
    ty = round(ROW_CY - r['h'] / 2)
    val_w = 2 * dw + r['deg']
    lay = {
        'week': {'x': pos['date'], 'y': round(ROW_CY - wk['h'] / 2)},
        'day': {'x': pos['date'] + wk['w'] + 5, 'y': ty},
        'month': {'x': pos['date'] + wk['w'] + 5 + 2 * dw + 5, 'y': round(ROW_CY - mo['h'] / 2)},
        'tempIcon': {'x': pos['temp'], 'y': ROW_CY - ICON // 2},
        'temp': {'x': pos['temp'] + ICON + 2, 'y': ty, 'w': r['minus'] + val_w},
        'highIcon': {'x': pos['hilo'], 'y': ROW_CY - TRI // 2},
        'high': {'x': pos['hilo'] + TRI + 2, 'y': ty, 'w': val_w},
        'lowIcon': {'x': pos['hilo'] + TRI + 2 + val_w + 6, 'y': ROW_CY - TRI // 2},
        'low': {'x': pos['hilo'] + 2 * (TRI + 2) + val_w + 6, 'y': ty, 'w': val_w},
        'humIcon': {'x': pos['hum'], 'y': ROW_CY - ICON // 2},
        'hum': {'x': pos['hum'] + ICON + 2, 'y': ty, 'w': 3 * dw + r['pct']},
        'weatherTap': {'x': pos['temp'] - 6, 'y': 260, 'w': ROW_X1 + 6 - (pos['temp'] - 6), 'h': 32},
        'gap': round(gap, 1),
    }
    metrics['dateRow'] = lay
    return lay


def write_metrics_js():
    path = os.path.join(ROOT, 'watchface', 'metrics.js')
    with open(path, 'w') as f:
        f.write('// Generated by tools/gen_assets.py: glyph sizes and computed positions. Do not edit.\n')
        f.write(f'export const M = {json.dumps(metrics, indent=2)}\n')


def main():
    os.makedirs(OUT, exist_ok=True)

    # Normal mode
    font_set('time', 146, WHITE, ('colon',), pad_x=2)
    font_set('stat', 24, WHITE, ('dot', 'slash'))
    font_set('batt', 44, WHITE, ('pct',))
    font_set('row', 22, WHITE, ('deg', 'pct', 'minus', 'invalid'), pad_x=0)
    font_set('tile', 32, WHITE, ('pct', 'colon', 'invalid'))
    font_set('bot', 30, WHITE, ('invalid',))
    word_set('week', WEEK, 22, ORANGE, align='right')
    word_set('month', MONTHS, 22, WHITE)

    # Always-on mode (dim grey)
    font_set('aod', 146, AOD_GRAY, ('colon',), pad_x=2)
    font_set('aod_date', 30, AOD_GRAY, weight='Bold')
    font_set('aod_batt', 24, AOD_GRAY, ('pct',))
    word_set('aod_week', WEEK, 30, AOD_GRAY, align='right')
    word_set('aod_month', MONTHS, 30, AOD_GRAY)

    icon('steps', 'footprint', 22, STEPS)
    icon('cal', 'local_fire_department', 22, CAL)
    icon('stand', 'accessibility_new', 22, STAND)
    icon('dist', 'distance', 22, DIST)
    icon('battery', 'battery_horiz_075', 30, GOOD)
    icon('temp', 'device_thermostat', 20, TEMP)
    icon('humidity', 'humidity_percentage', 20, HUMID)
    triangle('high', 11, '#ff6b5a', up=True)
    triangle('low', 11, '#4da3ff', up=False)
    icon('hr', 'ecg_heart', 30, HR)
    icon('spo2', 'spo2', 30, SPO2)
    icon('sleep', 'bedtime', 30, SLEEP)
    icon('hybrid', 'electric_bolt', 26, HYBRID)
    icon('stress', 'psychology', 26, STRESS)

    bar_set('battery', 118, 14, lambda i: BAD if i <= 2 else (WARN if i <= 4 else GOOD))
    bar_set('hybrid', 68, 8, lambda i: HYBRID)
    bar_set('stress', 68, 8, lambda i: STRESS)
    bar_set('aod_battery', 46, 12, lambda i: '#4a4a50')

    lay = date_row()
    press_overlay('activity', 198, 102)
    press_overlay('tile', 114, 68, radius=12)
    press_overlay('stress', 150, 40, radius=12)
    press_overlay('weather', lay['weatherTap']['w'], lay['weatherTap']['h'], radius=10)
    app_icon()

    write_metrics_js()
    print(json.dumps(metrics, indent=1))


if __name__ == '__main__':
    main()
