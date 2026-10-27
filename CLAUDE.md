# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Vitalis is a Zepp OS (API 3.0) watchface for the Amazfit Bip 6 (390 × 450 AMOLED). See README.md for what each area shows and what it opens when tapped.

## Commands

Needs Node 22+, the Zeus CLI (`npm i -g @zeppos/zeus-cli`), Python 3 with Pillow, and the fonts (`tools/fetch_fonts.sh`, once; they go to the git-ignored `tools/fonts/`).

```sh
python3 tools/gen_assets.py          # regenerate every image in assets/bip6/ and watchface/metrics.js
npm run preview                      # preview/normal.png, aod.png, alerts.png (alert colours + 12-hour) and assets/bip6/icon.png
zeus build                           # dist/*.zab
zeus preview -t "Amazfit Bip 6"      # QR code for the Zepp app (needs the full device name, not "bip6")
```

Run them in that order: `gen_assets.py` writes a placeholder `icon.png`, and `npm run preview` overwrites it with the real watchface-picker preview.

There is no test suite. The previews are the check: they run the real `watchface/index.js` against stubs. Other preview options for `node tools/preview/record.mjs > preview/widgets.json && python3 tools/preview/render.py preview/widgets.json [out.png]`:
- `PREVIEW_SAMPLE='{"hr":165,"battery":15,"h12":true,"time":[9,5],...}'` overrides the sample sensor values (see `SAMPLE` in `record.mjs`).
- `PREVIEW_SCENE=aod` starts the face as the always-on scene.
- `PREVIEW_NO_SHOW_LEVEL=1` mimics a `@zos/ui` without `show_level`.

If any section throws, the face draws a red error line at the bottom. It shows in the preview as a `TEXT` widget with text, so check a new change for one.

## Architecture

**The generator owns every pixel and position.** `tools/gen_assets.py` draws every image from Barlow Condensed and Material Symbols: fixed-width digit sets per colour, date words, icons, the heartbeat frames and the tap overlays. It also computes layouts from real glyph widths (date row in 24- and 12-hour variants, always-on layout, weather columns, the 2×4 vitals grid) and writes them to `watchface/metrics.js` as `M`. Never edit `metrics.js` or `assets/bip6/` by hand. Change colours, sizes, icons or positions in the generator and rerun it. It doesn't delete images it no longer makes, so `git rm` stale files.

**`watchface/index.js`** builds the face in independent sections (`buildActivity`, `buildStatus`, `buildBattery`, `buildDate`, `buildWeather`, `buildVitals`, `buildAod`, `buildVitalIcons`, `bindSensors`). Each runs inside `safely()`, so one failure can't blank the face. Most values are data-bound widgets (`TEXT_IMG`/`IMG_LEVEL` with `type: data_type.*`). JS only handles what data binding can't:
- the activity rings and the stand "now/goal" text
- colour states: `tintedValue()` stacks one hidden `TEXT_IMG` per colour set and shows the active one
- the battery icon fill, the weekday colour by sunrise/sunset, and the heartbeat animation

`refresh()` reruns these on every wrist raise (via `WIDGET_DELEGATE`).

**Always-on**: widgets carry `show_level` (`NORMAL` or `AOD`), and the always-on widgets are built hidden alongside the normal ones. When `getScene()` reports `SCENE_AOD`, only `buildAod()` runs.

**Preview stub**: `tools/preview/record.mjs` rewrites the `@zos/*` imports in `index.js` with regexes into stubs, records every `createWidget`/`setProperty` call, and `render.py` draws them with the real images. A new `@zos/*` import or widget type needs a stub there, and new widget types need drawing code in `render.py`.

## Bip 6 quirks (learned on the watch; keep these workarounds)

- There's no global `hmUI`; widgets come from `@zos/ui`.
- `TEXT_IMG` draws "0" for empty text, so hide inactive copies rather than blank them. It also appends its unit image by itself, so never put the unit in the text.
- `FILL_RECT` divider lines clipped neighbouring widgets, so dividers are 1 px images (`line/`).
- The watch drops the top pixel rows of an image whose glyphs touch its top edge. Text images carry `PAD = 3` transparent rows.
- A number widget blanks about 2× its height below its top, so weather digits and tap areas are kept short to avoid clipping the vitals row.
- Widgets created later draw over earlier ones. Vitals icons are created last for that reason.
- A `BUTTON` press image showed as a grey band behind the date, so the date tap has no highlight.
- Undocumented API behaviour relied on: `IMG_LEVEL` honouring `type` (weather condition icon), `IMG_TIME` `am_*`/`pm_*`, and the `prop.MORE` retiming of `IMG_ANIM`.

## Releasing

Bump the version in `package.json` and in `app.json` (`version.name` and `version.code`, which must increase with each store submission). Store files (packaged `.zab`, screenshots, `LISTING.md`) live in `release/`, which is git-ignored.
