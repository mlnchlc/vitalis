"""Draws the widgets recorded by record.mjs using the real asset images.

  node tools/preview/record.mjs > /tmp/widgets.json
  python3 tools/preview/render.py /tmp/widgets.json

Writes preview/normal.png and preview/aod.png (390 x 450), and
assets/bip6/icon.png, which Zepp uses as the watchface-picker preview.
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, 'assets', 'bip6')
W, H, CORNER = 390, 450, 86
SS = 4

# What each data_type shows in the preview
SAMPLE = {
    'STEP': '7486', 'CAL': '412', 'DISTANCE': '5.21', 'BATTERY': '62',
    'WEATHER_CURRENT': '24', 'WEATHER_HIGH': '31', 'WEATHER_LOW': '20', 'HUMIDITY': '79',
    'HEART': '74', 'SPO2': '98', 'SLEEP': '07.32', 'STRESS': '32', 'BIO_CHARGE': '72', 'UVI': '3', 'HRV': '48', 'PAI_WEEKLY': '86',
}
TIME = ('10', '08')
STATUS_ON = True  # draw every status icon, as if all were active
WEEKDAY = 5  # SAT (Monday first)
DAY, MONTH = '18', 9  # OCT


def load(rel):
    return Image.open(os.path.join(ASSETS, rel)).convert('RGBA')


def color(c):
    return '#%06x' % c


def draw_text_img(canvas, w):
    text = w.get('text')
    if text is None:
        text = SAMPLE.get(w.get('type'), '')
    # The watch appends the unit image to any TEXT_IMG that has one, data-bound or not
    if w.get('unit_en'):
        text += 'u'
    parts = []
    for ch in text:
        if ch.isdigit():
            parts.append(load(w['font_array'][int(ch)]))
        elif ch == '.' and w.get('dot_image'):
            parts.append(load(w['dot_image']))
        elif ch == '-' and w.get('negative_image'):
            parts.append(load(w['negative_image']))
        elif ch == 'u':
            parts.append(load(w['unit_en']))
    if not parts:
        return
    space = w.get('h_space', 0)
    total = sum(p.width for p in parts) + space * (len(parts) - 1)
    x = w['x']
    if w.get('align_h') == 'CENTER_H':
        x += (w['w'] - total) // 2
    elif w.get('align_h') == 'RIGHT':
        x += w['w'] - total
    for p in parts:
        canvas.alpha_composite(p, (x, w['y']))
        x += p.width + space


def draw_digits(canvas, x, y, text, array, space=0):
    for ch in text:
        img = load(array[int(ch)])
        canvas.alpha_composite(img, (x, y))
        x += img.width + space
    return x


def draw_time(canvas, w):
    x = draw_digits(canvas, w['hour_startX'], w['hour_startY'], TIME[0], w['hour_array'], w.get('hour_space', 0))
    colon = load(w['hour_unit_en'])
    canvas.alpha_composite(colon, (x, w['hour_startY']))
    draw_digits(canvas, x + colon.width, w['hour_startY'], TIME[1], w['minute_array'], w.get('minute_space', 0))


def draw_date(canvas, w):
    if 'day_startX' in w:
        if w.get('day_is_character'):
            canvas.alpha_composite(load(w['day_en_array'][int(DAY) - 1]), (w['day_startX'], w['day_startY']))
        else:
            draw_digits(canvas, w['day_startX'], w['day_startY'], DAY, w['day_en_array'], w.get('day_space', 0))
    if 'month_startX' in w:
        canvas.alpha_composite(load(w['month_en_array'][MONTH]), (w['month_startX'], w['month_startY']))


def draw_arc(canvas, w):
    level = w.get('level', 0)
    if level <= 0:
        return
    layer = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    r = w['radius'] * SS
    cx, cy = w['center_x'] * SS, w['center_y'] * SS
    start = w['start_angle']
    end = start + (w['end_angle'] - start) * level / 100
    lw = w['line_width'] * SS
    box = (cx - r - lw / 2, cy - r - lw / 2, cx + r + lw / 2, cy + r + lw / 2)
    ImageDraw.Draw(layer).arc(box, start, end, fill=color(w['color']), width=lw)
    canvas.alpha_composite(layer.resize((W, H), Image.LANCZOS))


def render(widgets, level):
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    d = ImageDraw.Draw(canvas)
    for w in widgets:
        if w.get('visible') is False:
            continue
        shown = w.get('show_level')
        if shown is not None and not (shown & level):
            continue
        if shown is None and level != 1 and w['widget'] != 'FILL_RECT':
            continue
        t = w['widget']
        if t == 'FILL_RECT':
            d.rectangle((w['x'], w['y'], w['x'] + w['w'] - 1, w['y'] + w['h'] - 1), fill=color(w['color']))
        elif t == 'IMG' or (t == 'IMG_STATUS' and STATUS_ON):
            canvas.alpha_composite(load(w['src']), (w['x'], w['y']))
        elif t == 'TEXT_IMG':
            draw_text_img(canvas, w)
        elif t == 'IMG_TIME':
            draw_time(canvas, w)
        elif t == 'IMG_WEEK':
            canvas.alpha_composite(load(w['week_en'][WEEKDAY]), (w['x'], w['y']))
        elif t == 'IMG_DATE':
            draw_date(canvas, w)
        elif t == 'ARC_PROGRESS':
            draw_arc(canvas, w)
        elif t == 'IMG_ANIM':
            frame = w.get('default_frame_index', 0)
            canvas.alpha_composite(load(f"{w['anim_path']}/{w['anim_prefix']}_{frame}.{w['anim_ext']}"), (w['x'], w['y']))
        elif t == 'IMG_LEVEL':
            v = int(SAMPLE.get(w.get('type'), '0'))
            idx = round(v / 100 * (w['image_length'] - 1))
            canvas.alpha_composite(load(w['image_array'][idx]), (w['x'], w['y']))
        # BUTTON overlays are transparent until pressed; WIDGET_DELEGATE draws nothing
    mask = Image.new('L', (W * SS, H * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, W * SS - 1, H * SS - 1), CORNER * SS, fill=255)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.paste(canvas, (0, 0), mask.resize((W, H), Image.LANCZOS))
    return out


def main():
    global TIME
    with open(sys.argv[1]) as f:
        data = json.load(f)
    TIME = (data['time'][:2], data['time'][2:])
    widgets = data['widgets']
    out_dir = os.path.join(ROOT, 'preview')
    os.makedirs(out_dir, exist_ok=True)
    # Optional second argument: render only the normal screen to that name
    if len(sys.argv) > 2:
        render(widgets, 1).save(os.path.join(out_dir, sys.argv[2]))
        print(f'wrote preview/{sys.argv[2]}')
        return
    normal = render(widgets, 1)
    normal.save(os.path.join(out_dir, 'normal.png'))
    render(widgets, 2).save(os.path.join(out_dir, 'aod.png'))
    normal.resize((266, 307), Image.LANCZOS).save(os.path.join(ASSETS, 'icon.png'))
    print('wrote preview/normal.png, preview/aod.png, assets/bip6/icon.png')


if __name__ == '__main__':
    main()
