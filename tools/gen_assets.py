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
# Zepp stress zones: relaxed 1-39, normal 40-59, medium 60-79, high 80-100
STRESS_ZONES = {'relaxed': '#4da3ff', 'normal': '#34d399', 'medium': '#ffb020', 'high': '#ff4545'}
# Value colours for health tiles: HR zones and SpO2 / sleep warnings
TILE_TINTS = {'orange': '#ff9f43', 'red': '#ff4545', 'amber': '#ffb020'}
# Weekday accent by time of day
WEEK_PHASES = {'dawn': '#ffc46b', 'day': ORANGE, 'dusk': '#ff5e7e', 'night': '#7b8cff'}

SS = 4  # supersampling factor for icons and shapes

# Middle rows: date centred on y 268, weather (five equal columns over
# x 24..366) centred on y 301. Health tiles centred on y 346.
DATE_CY = 268
WEATHER_X0, WEATHER_X1, WEATHER_CY = 24, 366, 301
TILE_X0, TILE_W, TILE_CY = 24, 114, 346

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


def font_set(name, size, color, extras=(), weight='SemiBold', pad_x=1, top=None, proportional=False):
    """top: shared distance above the baseline (negative) so several sets line up.
    proportional: each digit keeps its own width (no gap around "1"); slots are
    still sized from the widest digit."""
    font = ImageFont.truetype(BARLOW[weight], size)
    if top is None:
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

    m = {'h': h, 'digit_w': digit_w, 'cap': -font.getbbox('0', anchor='ls')[1]}
    widths = []
    for d in '0123456789':
        widths.append(save(glyph(d, None if proportional else digit_w), f'font/{name}/{d}.png').width)
    m['avg_w'] = round(sum(widths) / 10, 1)
    for key in extras:
        m[key] = save(glyph(EXTRAS[key]), f'font/{name}/{key}.png').width
    metrics[name] = m


def day_set(name, size, color, top):
    """Days 1-31 as whole words (IMG_DATE day_is_character) so each number is
    properly spaced, centred in one shared width so the month can sit at fixed x."""
    word_set(name, [str(d) for d in range(1, 32)], size, color, align='center', top=top, weight='Bold')


def word_set(name, words, size, color, align='left', top=None, weight='Bold'):
    """All images in a set share one width so neighbours can sit at fixed x."""
    font = ImageFont.truetype(BARLOW[weight], size)
    if top is None:
        top = font.getbbox('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', anchor='ls')[1]
    h = -top + 1
    w = max(math.ceil(font.getlength(word)) for word in words) + 1
    for i, word in enumerate(words):
        mask = Image.new('L', (w, h), 0)
        tw = font.getlength(word)
        x = {'right': w - tw, 'center': (w - tw) / 2}.get(align, 0)
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


# "lub-dub" pulse: scale of the heart in each frame
HEARTBEAT = [1.0, 1.1, 1.2, 1.05, 1.15, 1.0]
HEART_PAD = 3  # frames are larger than the icon so the 120% frame isn't clipped


def heartbeat_frames(size):
    canvas = size + 2 * HEART_PAD
    for i, scale in enumerate(HEARTBEAT):
        s = round(size * scale)
        heart = tint(symbol_mask('ecg_heart', s), HR)
        img = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
        img.alpha_composite(heart, ((canvas - s) // 2, (canvas - s) // 2))
        save(img, f'anim/hr/hr_{i}.png')
    metrics['heartbeat'] = {'frames': len(HEARTBEAT), 'pad': HEART_PAD}


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

def cap_mid(y, m):
    """y of the middle of the digits for a set drawn at y (icons centre on it)."""
    return y + m['h'] - 1 - m['cap'] / 2


def date_row():
    """Day, date and month centred as one group. All three share one height."""
    wk, mo, day = metrics['week_day'], metrics['month'], metrics['day']
    total = wk['w'] + 6 + day['w'] + 6 + mo['w']
    x = round((390 - total) / 2)
    y = round(DATE_CY - wk['h'] / 2)
    metrics['dateRow'] = {
        'week': {'x': x, 'y': y},
        'day': {'x': x + wk['w'] + 6, 'y': y},
        'month': {'x': x + wk['w'] + 6 + day['w'] + 6, 'y': y},
    }


def weather_row():
    """Five equal columns: temp, high, low, humidity, UV. Each icon+value pair
    is centred in its column for a typical value; values are left-aligned
    after their icon so longer ones grow to the right."""
    r = metrics['wx']
    dw, avg = r['digit_w'], r['avg_w']
    y = round(WEATHER_CY - r['h'] / 2)
    mid = cap_mid(y, r)
    col_w = (WEATHER_X1 - WEATHER_X0) / 5
    items = [  # key, icon, icon size, gap, typical value width, slot width
        ('temp', 'temp', 20, 2, 2 * avg + r['deg'], r['minus'] + 2 * dw + r['deg']),
        ('high', 'high', 11, 3, 2 * avg + r['deg'], r['minus'] + 2 * dw + r['deg']),
        ('low', 'low', 11, 3, 2 * avg + r['deg'], r['minus'] + 2 * dw + r['deg']),
        ('hum', 'humidity', 20, 2, 2 * avg + r['pct'], 3 * dw + r['pct']),
        ('uv', 'uv', 20, 3, avg, 2 * dw),
    ]
    lay = {}
    for i, (key, icon_name, size, gap, typical, slot) in enumerate(items):
        x = round(WEATHER_X0 + col_w * i + (col_w - (size + gap + typical)) / 2)
        lay[key + 'Icon'] = {'x': x, 'y': round(mid - size / 2), 'src': f'icon/{icon_name}.png'}
        lay[key] = {'x': x + size + gap, 'y': y, 'w': slot}
    lay['tap'] = {'x': WEATHER_X0, 'y': WEATHER_CY - 15, 'w': WEATHER_X1 - WEATHER_X0, 'h': 30}
    metrics['weatherRow'] = lay


def tiles_row():
    """Three tiles, icon beside value, the pair centred for a typical value."""
    t = metrics['tile']
    avg = t['avg_w']
    y = round(TILE_CY - t['h'] / 2)
    mid = cap_mid(y, t)
    ICON, GAP = 24, 8
    typical = {'hr': 2 * avg, 'spo2': 2 * avg + t['pct'], 'sleep': 4 * avg + t['colon']}
    lay = {}
    for i, key in enumerate(('hr', 'spo2', 'sleep')):
        col = TILE_X0 + TILE_W * i
        x = round(col + (TILE_W - (ICON + GAP + typical[key])) / 2)
        lay[key] = {'col': col, 'iconX': x, 'iconY': round(mid - ICON / 2), 'x': x + ICON + GAP, 'y': y}
    metrics['tiles'] = lay


def shared_top(size, probe='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789%°'):
    """Highest point above the baseline across the Bold and SemiBold cuts."""
    return min(ImageFont.truetype(BARLOW[w], size).getbbox(probe, anchor='ls')[1] for w in ('Bold', 'SemiBold'))


def write_metrics_js():
    path = os.path.join(ROOT, 'watchface', 'metrics.js')
    with open(path, 'w') as f:
        f.write('// Generated by tools/gen_assets.py: glyph sizes and computed positions. Do not edit.\n')
        f.write(f'export const M = {json.dumps(metrics, indent=2)}\n')


def main():
    os.makedirs(OUT, exist_ok=True)

    # Normal mode
    font_set('time', 132, WHITE, ('colon',), pad_x=2)
    font_set('stat', 24, WHITE, ('dot', 'slash'))
    font_set('batt', 40, WHITE, ('pct',))
    font_set('tile', 28, WHITE, ('pct', 'colon', 'invalid'), proportional=True)
    for tint_name, c in TILE_TINTS.items():
        font_set(f'tile_{tint_name}', 28, c, ('pct', 'colon', 'invalid'), proportional=True)
    font_set('bot', 30, WHITE, ('invalid',))
    for zone, c in STRESS_ZONES.items():
        font_set(f'bot_{zone}', 30, c)
    # Date row: day/date/month share one height so they share a baseline
    date_top = shared_top(24)
    for phase, c in WEEK_PHASES.items():
        word_set(f'week_{phase}', WEEK, 24, c, align='right', top=date_top)
    word_set('month', MONTHS, 24, WHITE, top=date_top)
    day_set('day', 24, WHITE, top=date_top)
    font_set('wx', 22, WHITE, ('deg', 'pct', 'minus', 'invalid'), pad_x=0, proportional=True)

    # Always-on mode (dim grey)
    font_set('aod', 132, AOD_GRAY, ('colon',), pad_x=2)
    aod_top = shared_top(30)
    word_set('aod_week', WEEK, 30, AOD_GRAY, align='right', top=aod_top)
    word_set('aod_month', MONTHS, 30, AOD_GRAY, top=aod_top)
    day_set('aod_day', 30, AOD_GRAY, top=aod_top)
    font_set('aod_batt', 24, AOD_GRAY, ('pct',))

    icon('steps', 'footprint', 22, STEPS)
    icon('cal', 'local_fire_department', 22, CAL)
    icon('stand', 'accessibility_new', 22, STAND)
    icon('dist', 'distance', 22, DIST)
    icon('battery', 'battery_horiz_075', 30, GOOD)
    icon('temp', 'device_thermostat', 20, TEMP)
    icon('humidity', 'humidity_percentage', 20, HUMID)
    triangle('high', 11, '#ff6b5a', up=True)
    triangle('low', 11, '#4da3ff', up=False)
    icon('hr', 'ecg_heart', 24, HR)
    heartbeat_frames(24)
    icon('spo2', 'spo2', 24, SPO2)
    icon('sleep', 'bedtime', 24, SLEEP)
    icon('hybrid', 'electric_bolt', 26, HYBRID)
    icon('stress', 'psychology', 26, STRESS)
    for zone, c in STRESS_ZONES.items():
        icon(f'stress_{zone}', 'psychology', 26, c)
    # Status icons: each shown only while its state is active
    icon('bt_off', 'bluetooth_disabled', 24, BAD)
    icon('dnd', 'do_not_disturb_on', 24, '#a78bfa')
    icon('alarm', 'alarm', 24, '#ffc94d')
    icon('lock', 'lock', 24, '#8c8c96')
    icon('uv', 'sunny', 20, '#ffd84d')

    bar_set('battery', 118, 12, lambda i: BAD if i <= 2 else (WARN if i <= 4 else GOOD))
    bar_set('hybrid', 68, 8, lambda i: HYBRID)
    for zone, c in STRESS_ZONES.items():
        bar_set(f'stress_{zone}', 68, 8, lambda i, c=c: c)
    bar_set('aod_battery', 46, 12, lambda i: '#4a4a50')

    date_row()
    weather_row()
    tiles_row()
    wt = metrics['weatherRow']['tap']
    press_overlay('activity', 198, 102)
    press_overlay('tile', TILE_W, 36, radius=12)
    press_overlay('stress', 150, 40, radius=12)
    press_overlay('weather', wt['w'], wt['h'], radius=10)
    app_icon()

    write_metrics_js()
    print(json.dumps(metrics, indent=1))


if __name__ == '__main__':
    main()
