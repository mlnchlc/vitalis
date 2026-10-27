# Vitalis

A health- and time-focused watchface for the **Amazfit Bip 6** (Zepp OS, API level 3.0+).

![preview](preview/normal.png)

| Area | Shows | Tap opens |
|---|---|---|
| Top left | Activity rings (steps / calories / stand goal) · steps · kcal · stand hours (now/goal) · km | Activity |
| Top right | Status icons, each shown only while active: Bluetooth disconnected · DND · alarm set · locked<br>Battery icon and % | Settings |
| Middle | HH:MM, full width | Alarms |
| Date | Weekday · date · month, centred; AM/PM after the month in 12-hour mode | Calendar |
| Weather | Four equal columns: condition icon + temp · high ▲ · low ▼ · humidity | Weather |
| Vitals (2 × 4) | Heart rate · SpO₂ · HRV · Stress<br>HybridCharge · sleep (h:mm) · PAI · UV index | Each opens its own app or page (UV opens Weather) |
| Always-on | Hollow time at the same size and spot, letter-spaced date, steps · kcal · battery % | – |

**Dynamic states** (see `preview/alerts.png`):

| Element | Changes |
|---|---|
| Stress | Icon and value coloured by zone: relaxed 1–39 blue · normal 40–59 green · medium 60–79 orange · high 80–100 red |
| Heart rate | White below 60% of max HR (220 − age from your Zepp profile), orange 60–79%, red ≥ 80% |
| SpO₂ | Red below 92% |
| Sleep | Amber under 6 h |
| Battery | Icon fills in 25% steps; icon and % are green > 40, amber 21–40, red ≤ 20 |
| Weather icon | One of 29 conditions (sun, cloud, rain, snow, storm, fog/dust, clear and cloudy night) |
| Weekday | Gold at dawn (sunrise ± 1 h), orange by day, pink at dusk (sunset ± 1 h), blue at night |
| Heart icon | ~3 s "lub-dub" pulse at your current heart rate after each wrist raise |

Device: 1.97" AMOLED, 390 × 450, rounded square (r = 86); deviceSource 9765120, 9765121, 10158337.

## Build and install

Needs Node 22+ and the Zeus CLI.

```sh
npm i -g @zeppos/zeus-cli
zeus build      # writes dist/*.zab
zeus preview -t "Amazfit Bip 6"    # QR code; scan in the Zepp app (Profile → Settings → About → tap the logo 7× for Developer Mode)
zeus dev        # run in the Zepp OS simulator
```

## Changing the design

Every image is generated, so colours, sizes and icons are edited in one place:

```sh
tools/fetch_fonts.sh          # once: Barlow Condensed + Material Symbols into tools/fonts/
python3 tools/gen_assets.py   # regenerates assets/bip6/** and watchface/metrics.js
npm run preview               # renders preview/normal.png, aod.png and alerts.png (12-hour) from the real index.js
```

`gen_assets.py` also computes the date (24- and 12-hour), weather and vitals layouts from the real glyph widths. `npm run preview` runs `watchface/index.js` against a stub of the
watch UI and draws exactly the widgets it creates. The normal render is also saved as
`assets/bip6/icon.png`, the watchface-picker preview.

## Structure

```
app.json               targets, deviceSource, permissions
watchface/index.js     the watchface: widgets, sensor bindings, tap targets
watchface/metrics.js   generated glyph sizes + computed layout positions
assets/bip6/           generated images (digit fonts, date words, icons, tap overlays, icon.png)
tools/gen_assets.py    image + metrics generator
tools/preview/         stub renderer for previews
```

## Known limits

- **HybridCharge** is read from `data_type.BIO_CHARGE` (its pre-2026 name, confirmed on a
  Bip 6).
- The **weather icon** relies on `IMG_LEVEL` with `type: WEATHER_CURRENT` picking the image by
  weather code, which Watchface Maker uses but the API reference doesn't document.
- **AM/PM** uses `IMG_TIME`'s `am_*`/`pm_*` fields, and the date layout is chosen from
  `getTimeFormat()` when the face loads; switching 12/24-hour takes effect the next time it loads.
- The date's tap area has no press highlight: on the watch it showed as a grey band.
- **Always-on** needs `"lockscreen": 1` in `app.json`; without it the watch uses its default
  AOD. On the watch, set Always-On Display to follow the watch face.
- The Bip 6 has no global `hmUI`; widgets come from `@zos/ui`. An empty-text `TEXT_IMG`
  draws "0", and `TEXT_IMG` appends its unit image even to set text.
- The heartbeat retimes `IMG_ANIM` with `setProperty(prop.MORE, { anim_fps, repeat_count })`
  before each start. If the firmware ignores that, it pulses at a fixed 8 fps instead.
