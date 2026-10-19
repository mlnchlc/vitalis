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

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'tools', 'fonts')
OUT = os.path.join(ROOT, 'assets', 'bip6')

BARLOW = {w: os.path.join(FONTS, f'BarlowCondensed-{w}.ttf') for w in ('Medium', 'SemiBold', 'Bold')}
SYMBOLS = os.path.join(FONTS, 'MaterialSymbolsRounded.ttf')

WHITE = '#ffffff'
AOD_GRAY = '#7a7a80'
AOD_OUTLINE = '#8d8d94'
AOD_DIM = '#5a5a62'
ORANGE = '#ff8a1f'
STEPS = '#2ee6ff'
CAL = '#ff5a36'
STAND = '#b6f23a'
DIST = '#a98bff'
HR = '#ff3b5c'
SPO2 = '#ff8fa3'  # heart family: red / rose / pink
STRESS = '#ffb020'
HYBRID = '#2dd4bf'  # recovery family: teal / aqua / green
HRV = '#ff6fae'
READINESS = '#f5c542'
PAI = '#4ade80'
SLEEP = '#67e8f9'
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
# Transparent rows above and below every text image. The watch drops the top
# pixel rows of an image whose glyphs touch its top edge, which shaved the
# tops off every digit.
PAD = 3

# Layout (cohesive version): 24 px margins, everything on a 4 px grid.
# Date centred on y 274, weather (four equal columns over x 24..366) on
# y 303, and a 2 x 4 vitals block whose rows are centred on y 348 and 396.
MARGIN_X0, MARGIN_X1 = 24, 366
DATE_CY = 274
WEATHER_CY = 301
VITAL_ROWS = (348, 396)
VITALS = (('hr', 'spo2', 'hrv', 'stress'), ('hybrid', 'sleep', 'pai', 'uv'))
ICON, GAP = 24, 6  # value icons and the icon-to-value gap used everywhere

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


def font_set(name, size, color, extras=(), weight='SemiBold', pad_x=1, top=None, proportional=False, compact_deg=False, outline=0):
    """top: shared distance above the baseline (negative) so several sets line up.
    proportional: each digit keeps its own width (no gap around "1"); slots are
    still sized from the widest digit. outline: stroke width in px; draws hollow
    glyphs (rendered 4x and eroded, so the stroke is smooth)."""
    font = ImageFont.truetype(BARLOW[weight], size)
    if top is None:
        probe = '0123456789%' + ('°' if 'deg' in extras and not compact_deg else '')
        top = font.getbbox(probe, anchor='ls')[1]  # negative: distance above baseline
    h = -top + 1 + 2 * PAD  # transparent margin above and below the glyphs
    digit_w = max(math.ceil(font.getlength(c)) for c in '0123456789') + pad_x

    def glyph(text, w=None):
        w = w or math.ceil(font.getlength(text)) + pad_x
        tw = font.getlength(text)
        if outline:
            big_font = ImageFont.truetype(BARLOW[weight], size * SS)
            filled = Image.new('L', (w * SS, h * SS), 0)
            ImageDraw.Draw(filled).text(((w - tw) / 2 * SS, (h - 1 - PAD) * SS), text, font=big_font, fill=255, anchor='ls')
            inner = filled.filter(ImageFilter.MinFilter(2 * outline * SS + 1))
            ring = ImageChops.subtract(filled, inner)
            return tint(ring.resize((w, h), Image.LANCZOS), color)
        mask = Image.new('L', (w, h), 0)
        ImageDraw.Draw(mask).text(((w - tw) / 2, h - 1 - PAD), text, font=font, fill=255, anchor='ls')
        return tint(mask, color)

    m = {'h': h, 'digit_w': digit_w, 'cap': -font.getbbox('0', anchor='ls')[1]}
    widths = []
    for d in '0123456789':
        widths.append(save(glyph(d, None if proportional else digit_w), f'font/{name}/{d}.png').width)
    m['avg_w'] = round(sum(widths) / 10, 1)
    for key in extras:
        if key == 'deg' and compact_deg:
            # Keep the set as short as the digits: draw ° with its top on the box top
            w = math.ceil(font.getlength('°')) + pad_x
            mask = Image.new('L', (w, h), 0)
            dtop = font.getbbox('°', anchor='ls')[1]
            ImageDraw.Draw(mask).text((0, h - 1 - PAD + (top - dtop)), '°', font=font, fill=255, anchor='ls')
            m[key] = save(tint(mask, color), f'font/{name}/deg.png').width
            continue
        m[key] = save(glyph(EXTRAS[key]), f'font/{name}/{key}.png').width
    metrics[name] = m


def day_set(name, size, color, top, tracking=0):
    """Days 1-31 as whole words (IMG_DATE day_is_character) so each number is
    properly spaced, centred in one shared width so the month can sit at fixed x."""
    word_set(name, [str(d) for d in range(1, 32)], size, color, align='center', top=top, weight='Bold', tracking=tracking)


def word_set(name, words, size, color, align='left', top=None, weight='Bold', tracking=0):
    """All images in a set share one width so neighbours can sit at fixed x.
    tracking: extra px between letters."""
    font = ImageFont.truetype(BARLOW[weight], size)
    if top is None:
        top = font.getbbox('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', anchor='ls')[1]
    h = -top + 1 + 2 * PAD

    def width(word):
        return sum(font.getlength(c) for c in word) + tracking * (len(word) - 1)

    w = max(math.ceil(width(word)) for word in words) + 1
    for i, word in enumerate(words):
        mask = Image.new('L', (w, h), 0)
        tw = width(word)
        x = {'right': w - tw, 'center': (w - tw) / 2}.get(align, 0)
        d = ImageDraw.Draw(mask)
        for c in word:
            d.text((x, h - 1 - PAD), c, font=font, fill=255, anchor='ls')
            x += font.getlength(c) + tracking
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
    """The glyph scaled to fit a size x size square with a 1 px margin.
    (Cropping a fixed em square cut the tops off filled glyphs like the heart.)"""
    big = size * SS
    font = ImageFont.truetype(SYMBOLS, big)
    font.set_variation_by_axes([fill, 0, 48, weight])
    canvas = Image.new('L', (big * 2, big * 2), 0)
    ImageDraw.Draw(canvas).text((big, big), codepoint(name), font=font, fill=255, anchor='mm')
    glyph = canvas.crop(canvas.getbbox())
    inner = (size - 2) * SS
    scale = min(inner / glyph.width, inner / glyph.height)
    glyph = glyph.resize((max(1, round(glyph.width * scale)), max(1, round(glyph.height * scale))), Image.LANCZOS)
    square = Image.new('L', (big, big), 0)
    square.paste(glyph, ((big - glyph.width) // 2, (big - glyph.height) // 2))
    return square.resize((size, size), Image.LANCZOS)


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
    return y + m['h'] - 1 - PAD - m['cap'] / 2


def date_row():
    """Day, date and month centred as one group. All three share one height."""
    wk, mo, day = metrics['week_day'], metrics['month'], metrics['day']
    total = wk['w'] + GAP + day['w'] + GAP + mo['w']
    x = round((390 - total) / 2)
    y = round(DATE_CY - wk['h'] / 2)
    metrics['dateRow'] = {
        'week': {'x': x, 'y': y},
        'day': {'x': x + wk['w'] + GAP, 'y': y},
        'month': {'x': x + wk['w'] + GAP + day['w'] + GAP, 'y': y},
    }


def aod_layout():
    """Always-on positions (screen px). The time is at the normal screen's
    position (TIME_Y in index.js); date on y 274 (the normal date's row),
    steps/calories on y 312, battery % on y 356."""
    t, wk, mo, day = metrics['aod'], metrics['aod_week'], metrics['aod_month'], metrics['aod_day']
    gap = 14
    total = wk['w'] + gap + day['w'] + gap + mo['w']
    x = round((390 - total) / 2)
    dy = round(274 - wk['h'] / 2)
    metrics['aodLayout'] = {
        'week': {'x': x, 'y': dy},
        'day': {'x': x + wk['w'] + gap, 'y': dy},
        'month': {'x': x + wk['w'] + gap + day['w'] + gap, 'y': dy},
        'statsCy': 312,
        'battCy': 356,
    }


def weather_row():
    """Four equal columns: temp, high, low, humidity. Each icon+value pair is
    centred in its column for a typical value; values are left-aligned after
    their icon so longer ones grow to the right."""
    r = metrics['wx']
    dw, avg = r['digit_w'], r['avg_w']
    y = round(WEATHER_CY - r['h'] / 2)
    mid = cap_mid(y, r)
    col_w = (MARGIN_X1 - MARGIN_X0) / 4
    items = [  # key, icon, icon size, typical value width, slot width
        ('temp', 'temp', 24, 2 * avg + r['deg'], r['minus'] + 2 * dw + r['deg']),
        ('high', 'high', 13, 2 * avg + r['deg'], r['minus'] + 2 * dw + r['deg']),
        ('low', 'low', 13, 2 * avg + r['deg'], r['minus'] + 2 * dw + r['deg']),
        ('hum', 'humidity', 24, 2 * avg + r['pct'], 3 * dw + r['pct']),
    ]
    lay = {}
    for i, (key, icon_name, size, typical, slot) in enumerate(items):
        x = round(MARGIN_X0 + col_w * i + (col_w - (size + GAP + typical)) / 2)
        lay[key + 'Icon'] = {'x': x, 'y': round(mid - size / 2), 'src': f'icon/{icon_name}.png'}
        lay[key] = {'x': x + size + GAP, 'y': y, 'w': slot}
    # Short tap area: the watch blanks about 2x a widget's height below its top,
    # and a 30 px tap here clipped the numbers in the first vitals row.
    lay['tap'] = {'x': MARGIN_X0, 'y': WEATHER_CY - 10, 'w': MARGIN_X1 - MARGIN_X0, 'h': 20}
    metrics['weatherRow'] = lay


def vitals_grid():
    """2 x 4 cells, icon beside value, each pair centred in its cell for a
    typical value. Cells share column edges across both rows."""
    t = metrics['tile']
    avg = t['avg_w']
    col_w = (MARGIN_X1 - MARGIN_X0) / 4
    typical = {'hr': 2 * avg, 'spo2': 2 * avg + t['pct'], 'hrv': 2 * avg, 'stress': 2 * avg,
               'hybrid': 2 * avg, 'sleep': 3 * avg + t['colon'], 'pai': 2 * avg, 'uv': avg}
    lay = {'colW': round(col_w), 'cells': {}}
    for r, (cy, keys) in enumerate(zip(VITAL_ROWS, VITALS)):
        y = round(cy - t['h'] / 2)
        mid = cap_mid(y, t)
        for c, key in enumerate(keys):
            col = round(MARGIN_X0 + col_w * c)
            x = round(MARGIN_X0 + col_w * c + (col_w - (ICON + GAP + typical[key])) / 2)
            lay['cells'][key] = {'col': col, 'row': r, 'top': cy - 18, 'iconX': x,
                                 'iconY': round(mid - ICON / 2), 'x': x + ICON + GAP, 'y': y,
                                 'w': round(MARGIN_X0 + col_w * (c + 1)) - (x + ICON + GAP)}
    metrics['vitals'] = lay


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

    # Type: three tiers. Hero = time, primary = 28 (battery 40; also weather and
    # vitals, so the bottom three rows match), secondary = 22 (stats, date).
    font_set('time', 158, WHITE, ('colon',), pad_x=0)
    font_set('batt', 40, WHITE, ('pct',))
    for tint_name, c in (('amber', WARN), ('red', BAD)):
        font_set(f'batt_{tint_name}', 40, c, ('pct',))
    font_set('tile', 28, WHITE, ('pct', 'colon', 'invalid'), proportional=True)
    for tint_name, c in TILE_TINTS.items():
        font_set(f'tile_{tint_name}', 28, c, ('pct', 'colon', 'invalid'), proportional=True)
    for zone, c in STRESS_ZONES.items():
        font_set(f'tile_{zone}', 28, c, proportional=True)
    font_set('stat', 22, WHITE, ('dot', 'slash'))
    # compact_deg: the watch blanks about 2x a number widget's height below it,
    # so the weather digits must stay as short as the vitals digits (21 px) or
    # they clip the tops of the first vitals row's icons.
    font_set('wx', 28, WHITE, ('deg', 'pct', 'minus', 'invalid'), pad_x=0, proportional=True, compact_deg=True)
    # Date: day/date/month share one height so they share a baseline
    date_top = shared_top(22)
    for phase, c in WEEK_PHASES.items():
        word_set(f'week_{phase}', WEEK, 22, c, align='right', top=date_top)
    word_set('month', MONTHS, 22, WHITE, top=date_top)
    day_set('day', 22, WHITE, top=date_top)

    # Always-on: same sizes and positions as the normal screen, dim grey
    # Always-on v2: the time keeps its exact size and position but turns hollow;
    # the date is letter-spaced. The dim/wake switch reads as the digits
    # filling in.
    font_set('aod', 158, AOD_OUTLINE, ('colon',), pad_x=0, outline=2)
    word_set('aod_week', WEEK, 22, AOD_GRAY, align='right', top=date_top, tracking=3)
    word_set('aod_month', MONTHS, 22, AOD_GRAY, top=date_top, tracking=3)
    day_set('aod_day', 22, AOD_GRAY, top=date_top, tracking=3)
    font_set('aod_batt', 22, AOD_DIM, ('pct',))
    font_set('aod_stat', 22, AOD_GRAY)
    icon('aod_steps', 'footprint', 20, AOD_GRAY)
    icon('aod_cal', 'local_fire_department', 20, AOD_GRAY)

    # Icons: 20 px beside secondary text, 24 px beside primary values
    icon('steps', 'footprint', 20, STEPS)
    icon('cal', 'local_fire_department', 20, CAL)
    icon('stand', 'accessibility_new', 20, STAND)
    icon('dist', 'distance', 20, DIST)
    icon('temp', 'device_thermostat', 24, TEMP)
    icon('humidity', 'humidity_percentage', 24, HUMID)
    triangle('high', 13, '#ff6b5a', up=True)
    triangle('low', 13, '#4da3ff', up=False)
    icon('battery', 'battery_horiz_075', 24, GOOD)
    icon('hr', 'ecg_heart', 24, HR)
    heartbeat_frames(24)
    icon('spo2', 'spo2', 24, SPO2)
    icon('hrv', 'ecg', 24, HRV)
    icon('stress', 'psychology', 24, STRESS)
    for zone, c in STRESS_ZONES.items():
        icon(f'stress_{zone}', 'psychology', 24, c)
    icon('hybrid', 'electric_bolt', 24, HYBRID)
    icon('sleep', 'bedtime', 24, SLEEP)
    icon('pai', 'cardiology', 24, PAI)
    icon('uv', 'sunny', 24, '#ffd84d')
    # Status icons: each shown only while its state is active
    icon('bt_off', 'bluetooth_disabled', 24, BAD)
    icon('dnd', 'do_not_disturb_on', 24, '#a78bfa')
    icon('alarm', 'alarm', 24, '#ffc94d')
    icon('lock', 'lock', 24, '#8c8c96')

    # Divider lines as images: FILL_RECT lines clipped neighbouring widgets on the Bip 6
    save(Image.new('RGBA', (MARGIN_X1 - MARGIN_X0, 1), '#2a2a30'), 'line/h.png')
    for h in (24, 100):
        save(Image.new('RGBA', (1, h), '#2a2a30'), f'line/v{h}.png')

    time_w = 4 * metrics['time']['digit_w'] + metrics['time']['colon']
    assert time_w <= MARGIN_X1 - MARGIN_X0, f'time is {time_w}px, wider than the margins'
    date_row()
    aod_layout()
    weather_row()
    vitals_grid()
    wt = metrics['weatherRow']['tap']
    press_overlay('activity', 198, 102)
    press_overlay('cell', metrics['vitals']['colW'], 32, radius=10)
    press_overlay('weather', wt['w'], wt['h'], radius=10)
    press_overlay('time', MARGIN_X1 - MARGIN_X0, 116, radius=16)
    press_overlay('date', MARGIN_X1 - MARGIN_X0, 24, radius=8)
    press_overlay('status', 134, 104, radius=14)
    app_icon()

    write_metrics_js()
    print(json.dumps(metrics, indent=1))


if __name__ == '__main__':
    main()
