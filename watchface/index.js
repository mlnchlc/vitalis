import { Battery, Step, Calorie, Stand, Stress, HeartRate, BloodOxygen, Sleep, Time, Weather } from '@zos/sensor'
import { getProfile } from '@zos/user'
import {
  launchApp,
  SYSTEM_APP_STATUS,
  SYSTEM_APP_HR,
  SYSTEM_APP_SPO2,
  SYSTEM_APP_SLEEP,
  SYSTEM_APP_PRESSURE,
  SYSTEM_APP_PAI,
  SYSTEM_APP_WEATHER,
  SYSTEM_APP_ALARM,
  SYSTEM_APP_CALENDAR,
  SYSTEM_APP_SETTING
} from '@zos/router'
import * as zosUI from '@zos/ui'
import { getScene, SCENE_AOD } from '@zos/app'
import { M } from './metrics'

// Layout follows the approved "cohesive" wireframe: 390 x 450, 24 px margins,
// 4 px grid. Images live in assets/bip6 and are produced by tools/gen_assets.py,
// which also computes the date, weather and vitals positions in metrics.js.

// The Bip 6 has no global hmUI; widgets come from @zos/ui. Keep the global as
// a fallback for runtimes that still provide it.
const hmUI = typeof globalThis.hmUI === 'object' && globalThis.hmUI !== null ? globalThis.hmUI : zosUI
// show_level marks which widgets draw in normal and always-on mode (needs
// "lockscreen": 1 in app.json). Guard for runtimes without it; the face also
// checks getScene() and builds only the dim layout in the always-on scene.
const SHOW_LEVEL = hmUI.show_level && hmUI.show_level.ONAL_AOD !== undefined ? hmUI.show_level : null
const NORMAL = SHOW_LEVEL ? SHOW_LEVEL.ONLY_NORMAL : undefined
const AOD = SHOW_LEVEL ? SHOW_LEVEL.ONAL_AOD : undefined
const RING_TRACK = 0x2a2a30

// Top band (y 28-128): rings + stats on the left, status + battery on the right
const STAT_X = 120
const STAT_ROW_Y = (i) => 28 + i * 26 // 22 px rows; status icons align with row 0
const RIGHT_X = 244
const RIGHT_W = 118
const BATTERY_CY = 78 // middle of the rings
const DIVIDERS = [136, 324, 372]
const TIME_Y = 141 // digit images carry 3 px of padding above the glyphs

const digits = (set) => Array.from({ length: 10 }, (_, i) => `font/${set}/${i}.png`)
const words = (set, n) => Array.from({ length: n }, (_, i) => `date/${set}_${i}.png`)
const units = (src) => ({ unit_en: src, unit_sc: src, unit_tc: src, imperial_unit_en: src, imperial_unit_sc: src, imperial_unit_tc: src })
const pctOf = (cur, target) => (target > 0 ? Math.min(100, (cur * 100) / target) : 0)
const pad2 = (n) => String(n).padStart(2, '0')
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Thresholds agreed in the design. One status scale everywhere:
// blue relaxed, green good, amber caution, red alert.
const SPO2_LOW = 92 // % - below this SpO2 turns red
const SLEEP_SHORT = 6 * 60 // minutes - under this sleep turns amber
const HR_ELEVATED = 0.6 // fraction of max HR (220 - age) where HR turns orange
const HR_HIGH = 0.8 // ... and red
const BATTERY_LOW = 40 // % - battery turns amber at or below this
const BATTERY_CRITICAL = 20 // ... and red
const stressZone = (v) => (v < 40 ? 'relaxed' : v < 60 ? 'normal' : v < 80 ? 'medium' : 'high')

// HybridCharge (Amazfit's 2026 rename of BioCharge) isn't in the published
// API reference. On the Bip 6 it is data_type.BIO_CHARGE; later firmware may
// rename it, so try that first and then the likely new names.
const HYBRID_NAMES = ['BIO_CHARGE', 'HYBRID_CHARGE', 'HYBRIDCHARGE', 'BIOCHARGE']
function findDataType(names) {
  const dt = hmUI.data_type || {}
  const name = names.find((n) => dt[n] !== undefined)
  return name === undefined ? undefined : dt[name]
}

function create(type, opts = {}) {
  if (opts.show_level === undefined) {
    const { show_level, ...rest } = opts
    return hmUI.createWidget(type, rest)
  }
  return hmUI.createWidget(type, opts)
}

function inAodScene() {
  try {
    return getScene() === SCENE_AOD
  } catch (e) {
    return false
  }
}

function img(x, y, src, show_level = NORMAL) {
  return create(hmUI.widget.IMG, { x, y, src, show_level })
}

// Divider lines are 1 px images: on the Bip 6, FILL_RECT lines clipped the
// top of the row below them.
function hline(y) {
  img(24, y, 'line/h.png')
}

function vline(x, y, h) {
  img(x, y, `line/v${h}.png`)
}

function value(set, opts) {
  return create(hmUI.widget.TEXT_IMG, {
    font_array: digits(set),
    h_space: 0,
    align_h: hmUI.align.LEFT,
    h: M[set].h,
    show_level: NORMAL,
    ...opts
  })
}

// press: the image shown while held; pass the overlay name itself for no highlight
function tap(x, y, w, h, overlay, appId, press = `${overlay}_press`) {
  create(hmUI.widget.BUTTON, {
    x,
    y,
    w,
    h,
    text: '',
    normal_src: `press/${overlay}.png`,
    press_src: `press/${press}.png`,
    show_level: NORMAL,
    click_func: () => {
      // An app the watch doesn't have (e.g. Readiness) just does nothing
      try {
        launchApp({ appId, native: true })
      } catch (e) {}
    }
  })
}

function ring(cx, cy, radius, color) {
  const base = { center_x: cx, center_y: cy, radius, start_angle: -90, end_angle: 270, line_width: 9, show_level: NORMAL }
  create(hmUI.widget.ARC_PROGRESS, { ...base, color: RING_TRACK, level: 100 })
  const arc = create(hmUI.widget.ARC_PROGRESS, { ...base, color, level: 0 })
  return (level) => arc.setProperty(hmUI.prop.MORE, { ...base, color, level: Math.round(level) })
}

// One value drawn in one of several colours: a TEXT_IMG per colour set at
// the same spot, only the active one visible. show(null) shows "--".
// (An empty-text TEXT_IMG still draws "0" on the watch, so inactive copies
// are hidden rather than blanked. TEXT_IMG also appends its unit image by
// itself, so text never includes the unit.)
function tintedValue(sets, optsFor, invalidSrc, x, y, w) {
  const widgets = {}
  sets.forEach((set) => {
    widgets[set] = value(set, { x, y, w, ...optsFor(set), text: '0' })
    widgets[set].setProperty(hmUI.prop.VISIBLE, false)
  })
  const invalid = img(x, y, invalidSrc)
  invalid.setProperty(hmUI.prop.VISIBLE, false)
  return (active, text) => {
    sets.forEach((set) => {
      if (set === active) widgets[set].setProperty(hmUI.prop.TEXT, text)
      widgets[set].setProperty(hmUI.prop.VISIBLE, set === active)
    })
    invalid.setProperty(hmUI.prop.VISIBLE, active === null)
  }
}

// Day of week, day (whole pre-spaced images 1-31) and month, at fixed spots
function dateGroup(sets, pos, show_level) {
  if (sets.week) {
    create(hmUI.widget.IMG_WEEK, {
      x: pos.week.x,
      y: pos.week.y,
      week_en: words(sets.week, 7),
      week_tc: words(sets.week, 7),
      week_sc: words(sets.week, 7),
      show_level
    })
  }
  create(hmUI.widget.IMG_DATE, {
    day_startX: pos.day.x,
    day_startY: pos.day.y,
    day_is_character: true,
    day_en_array: words(sets.day, 31),
    day_sc_array: words(sets.day, 31),
    day_tc_array: words(sets.day, 31),
    show_level
  })
  create(hmUI.widget.IMG_DATE, {
    month_startX: pos.month.x,
    month_startY: pos.month.y,
    month_is_character: true,
    month_en_array: words(sets.month, 12),
    month_sc_array: words(sets.month, 12),
    month_tc_array: words(sets.month, 12),
    show_level
  })
}

function bigTime(set, show_level) {
  const width = 4 * M[set].digit_w + M[set].colon
  create(hmUI.widget.IMG_TIME, {
    hour_zero: 1,
    hour_startX: Math.round((390 - width) / 2),
    hour_startY: TIME_Y,
    hour_array: digits(set),
    hour_space: 0,
    hour_unit_sc: `font/${set}/colon.png`,
    hour_unit_tc: `font/${set}/colon.png`,
    hour_unit_en: `font/${set}/colon.png`,
    hour_align: hmUI.align.LEFT,
    minute_zero: 1,
    minute_array: digits(set),
    minute_space: 0,
    minute_follow: 1,
    show_level
  })
}

WatchFace({
  init_view() {
    this.errors = []
    create(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: 390, h: 450, color: 0x000000 })

    // Started for the always-on screen: draw only the dim layout
    if (inAodScene()) {
      this.safely('aod', () => this.buildAod())
      return
    }

    // Each part is built on its own so one failure can't blank the face
    this.safely('activity', () => this.buildActivity())
    this.safely('status', () => this.buildStatus())
    this.safely('battery', () => this.buildBattery())
    this.safely('lines', () => DIVIDERS.forEach(hline))
    this.safely('time', () => {
      bigTime('time', NORMAL)
      tap(24, TIME_Y, 342, 116, 'time', SYSTEM_APP_ALARM)
    })
    this.safely('date', () => this.buildDate())
    this.safely('weather', () => this.buildWeather())
    this.safely('vitals', () => this.buildVitals())
    // With show_level available, the always-on layout rides along hidden
    if (SHOW_LEVEL) this.safely('aod', () => this.buildAod())
    this.safely('vitalIcons', () => this.buildVitalIcons())
    this.safely('sensors', () => this.bindSensors())
    this.safely('delegate', () =>
      create(hmUI.widget.WIDGET_DELEGATE, {
        resume_call: () => this.refresh()
      })
    )
    this.showErrors()
  },

  safely(name, fn) {
    try {
      fn()
    } catch (e) {
      this.errors.push(`${name}: ${e && e.message ? e.message : e}`)
    }
  },

  // Small red line at the bottom naming what failed, so a photo of the watch
  // is enough to debug it. Nothing is drawn when everything works.
  showErrors() {
    if (!this.errors.length) return
    if (!this.errorText) {
      this.errorText = create(hmUI.widget.TEXT, {
        x: 40,
        y: 424,
        w: 310,
        h: 22,
        text_size: 14,
        color: 0xff4545,
        align_h: hmUI.align.CENTER_H,
        text: ''
      })
    }
    this.errorText.setProperty(hmUI.prop.TEXT, this.errors.slice(0, 2).join(' | '))
  },

  // ---- top left: activity rings + stats ----
  buildActivity() {
    // Outer to inner: steps, calories, stand
    this.rings = [ring(64, 78, 45, 0x2ee6ff), ring(64, 78, 34, 0xff5a36), ring(64, 78, 23, 0xb6f23a)]
    this.ringLevels = [0, 0, 0]

    const valY = (i) => STAT_ROW_Y(i) + Math.round((22 - M.stat.h) / 2)
    ;['steps', 'cal', 'stand', 'dist'].forEach((name, i) => img(STAT_X, STAT_ROW_Y(i) + 1, `icon/${name}.png`))
    const vx = STAT_X + 20 + 6
    value('stat', { x: vx, y: valY(0), w: 72, type: hmUI.data_type.STEP })
    value('stat', { x: vx, y: valY(1), w: 72, type: hmUI.data_type.CAL })
    // Stand shows "now/goal": the dot image is a slash, fed as "8.12".
    this.standText = value('stat', { x: vx, y: valY(2), w: 72, dot_image: 'font/stat/slash.png', text: '0' })
    value('stat', { x: vx, y: valY(3), w: 72, type: hmUI.data_type.DISTANCE, dot_image: 'font/stat/dot.png' })

    tap(14, 26, 198, 102, 'activity', SYSTEM_APP_STATUS)
    vline(226, 28, 100)
  },

  // ---- top right: status icons, each drawn only while its state is active ----
  buildStatus() {
    if (!hmUI.system_status) throw new Error('no system_status')
    const icons = [
      [hmUI.system_status.DISCONNECT, 'bt_off'],
      [hmUI.system_status.DISTURB, 'dnd'],
      [hmUI.system_status.CLOCK, 'alarm'],
      [hmUI.system_status.LOCK, 'lock']
    ]
    icons.forEach(([type, name], i) => {
      create(hmUI.widget.IMG_STATUS, {
        x: RIGHT_X + Math.round((i * (RIGHT_W - 24)) / 3),
        y: STAT_ROW_Y(0) - 1,
        type,
        src: `icon/${name}.png`,
        show_level: NORMAL
      })
    })
  },

  // ---- top right: battery, icon fill and % coloured by charge ----
  buildBattery() {
    this.batteryIcon = img(RIGHT_X, BATTERY_CY - 12, 'icon/battery/good_75.png')
    const b = M.batt
    this.showBattery = tintedValue(
      ['batt', 'batt_amber', 'batt_red'],
      (set) => units(`font/${set}/pct.png`),
      'font/tile/invalid.png',
      RIGHT_X + 24 + 6,
      BATTERY_CY - Math.round(b.h / 2),
      3 * b.digit_w + b.pct
    )
    // Status icons + battery together open Settings
    tap(RIGHT_X - 10, 24, 134, 104, 'status', SYSTEM_APP_SETTING)
  },

  // ---- middle: date (positions computed by gen_assets.py) ----
  buildDate() {
    const R = M.dateRow
    // Weekday is drawn by refreshAccent(): its colour follows the time of day
    this.weekday = img(R.week.x, R.week.y, 'date/week_day_0.png')
    dateGroup({ day: 'day', month: 'month' }, R, NORMAL)
    // Transparent in both states: the grey press highlight showed as a band
    // behind the date on the watch
    tap(24, R.week.y - 3, 342, 24, 'date', SYSTEM_APP_CALENDAR, 'date')
  },

  // ---- middle: weather, four equal columns; the first icon shows the condition ----
  buildWeather() {
    const R = M.weatherRow
    const temp = {
      negative_image: 'font/wx/minus.png',
      invalid_image: 'font/wx/invalid.png',
      ...units('font/wx/deg.png')
    }
    const fields = [
      ['temp', { type: hmUI.data_type.WEATHER_CURRENT, ...temp }],
      ['high', { type: hmUI.data_type.WEATHER_HIGH, ...temp }],
      ['low', { type: hmUI.data_type.WEATHER_LOW, ...temp }],
      ['hum', { type: hmUI.data_type.HUMIDITY, invalid_image: 'font/wx/invalid.png', ...units('font/wx/pct.png') }]
    ]
    // The condition icon is indexed by the weather code (0-28)
    create(hmUI.widget.IMG_LEVEL, {
      x: R.tempIcon.x,
      y: R.tempIcon.y,
      image_array: Array.from({ length: 29 }, (_, i) => `icon/weather/${i}.png`),
      image_length: 29,
      type: hmUI.data_type.WEATHER_CURRENT,
      show_level: NORMAL
    })
    fields.forEach(([key, opts]) => {
      const icon = R[`${key}Icon`]
      if (icon.src) img(icon.x, icon.y, icon.src)
      value('wx', { ...R[key], ...opts })
    })
    tap(R.tap.x, R.tap.y, R.tap.w, R.tap.h, 'weather', SYSTEM_APP_WEATHER)
  },

  // ---- vitals: 2 x 4 cells, icon beside value ----
  //   HR | SpO2 | HRV | Stress
  //   HybridCharge | Sleep | PAI | UV
  buildVitals() {
    const C = M.vitals.cells
    const colW = M.vitals.colW
    const invalid = 'font/tile/invalid.png'
    const at = (key) => [C[key].x, C[key].y, C[key].w]

    // Heart rate: animated icon, value coloured by HR zone
    this.showHr = tintedValue(['tile', 'tile_orange', 'tile_red'], () => ({}), invalid, ...at('hr'))

    this.showSpo2 = tintedValue(['tile', 'tile_red'], (set) => units(`font/${set}/pct.png`), invalid, ...at('spo2'))

    value('tile', { x: C.hrv.x, y: C.hrv.y, w: C.hrv.w, type: hmUI.data_type.HRV, invalid_image: invalid })

    // Stress: icon and value take the zone colour
    const zones = ['relaxed', 'normal', 'medium', 'high']
    this.showStress = tintedValue(zones.map((z) => `tile_${z}`), () => ({}), invalid, ...at('stress'))

    const hybridType = findDataType(HYBRID_NAMES)
    if (hybridType !== undefined) {
      value('tile', { x: C.hybrid.x, y: C.hybrid.y, w: C.hybrid.w, type: hybridType, invalid_image: invalid })
    } else {
      img(C.hybrid.x, C.hybrid.y, invalid)
    }

    // Sleep is "H.MM" with the dot image drawn as a colon
    this.showSleep = tintedValue(['tile', 'tile_amber'], (set) => ({ dot_image: `font/${set}/colon.png` }), invalid, ...at('sleep'))

    value('tile', { x: C.pai.x, y: C.pai.y, w: C.pai.w, type: hmUI.data_type.PAI_WEEKLY, invalid_image: invalid })

    value('tile', { x: C.uv.x, y: C.uv.y, w: C.uv.w, type: hmUI.data_type.UVI, invalid_image: invalid })

    // Every cell opens the closest system app
    const apps = {
      hr: SYSTEM_APP_HR,
      spo2: SYSTEM_APP_SPO2,
      stress: SYSTEM_APP_PRESSURE,
      sleep: SYSTEM_APP_SLEEP,
      pai: SYSTEM_APP_PAI,
      uv: SYSTEM_APP_WEATHER
    }
    Object.keys(apps).forEach((key) => tap(C[key].col, C[key].top + 2, colW, 32, 'cell', apps[key]))
    // HRV and HybridCharge have no system app ID; IMG_CLICK opens the
    // watch's own page for a data type instead.
    const dataTaps = { hrv: hmUI.data_type.HRV, hybrid: hybridType }
    Object.keys(dataTaps).forEach((key) => {
      if (dataTaps[key] === undefined) return
      create(hmUI.widget.IMG_CLICK, {
        x: C[key].col,
        y: C[key].top + 2,
        w: colW,
        h: 32,
        src: 'press/cell.png', // fully transparent: IMG_CLICK always draws its image
        type: dataTaps[key],
        show_level: NORMAL
      })
    })
    // Column separators, shared by both rows
    ;['spo2', 'hrv', 'stress'].forEach((key) => {
      vline(C[key].col, C.hr.top + 6, 24)
      vline(C[key].col, C.hybrid.top + 6, 24)
    })
  },

  // Vitals icons are created after everything else so no other widget can
  // be drawn over them (the first row's icon tops were clipped on the watch).
  buildVitalIcons() {
    const C = M.vitals.cells
    const hb = M.heartbeat
    this.heartAnim = create(hmUI.widget.IMG_ANIM, {
      x: C.hr.iconX - hb.pad,
      y: C.hr.iconY - hb.pad,
      anim_path: 'anim/hr',
      anim_prefix: 'hr',
      anim_ext: 'png',
      anim_fps: 8,
      anim_size: hb.frames,
      repeat_count: 1,
      anim_status: hmUI.anim_status ? hmUI.anim_status.STOP : 0,
      default_frame_index: 0,
      show_level: NORMAL
    })
    ;['spo2', 'hrv', 'hybrid', 'sleep', 'pai', 'uv'].forEach((key) => img(C[key].iconX, C[key].iconY, `icon/${key}.png`))
    this.stressIcon = img(C.stress.iconX, C.stress.iconY, 'icon/stress.png')
  },

  // ---- always-on display: hollow time (same spot), spaced date, steps / kcal / battery % row ----
  // The time keeps the normal screen's exact size and position but is hollow;
  // the date is letter-spaced, so the dim/wake switch reads as the digits
  // filling in.
  buildAod() {
    const A = M.aodLayout
    bigTime('aod', AOD) // same position as the normal time
    dateGroup({ week: 'aod_week', day: 'aod_day', month: 'aod_month' }, A, AOD)

    // Steps, calories and battery % on one row, dim, centred under the date
    const st = M.aod_stat
    const cy = A.statsCy
    const GAP = 22
    const items = [
      { icon: 'aod_steps', type: hmUI.data_type.STEP, digits: 5 },
      { icon: 'aod_cal', type: hmUI.data_type.CAL, digits: 4 },
      { icon: 'aod_batt', type: hmUI.data_type.BATTERY, digits: 3, unit: true }
    ]
    const widths = items.map((it) => 26 + it.digits * st.digit_w + (it.unit ? st.digit_w + 2 : 0))
    let x = Math.round((390 - (widths.reduce((a, w) => a + w, 0) + GAP * (items.length - 1))) / 2)
    const sy = cy - Math.round(st.h / 2)
    items.forEach((it, i) => {
      img(x, cy - 10, `icon/${it.icon}.png`, AOD)
      create(hmUI.widget.TEXT_IMG, {
        x: x + 26, y: sy, w: widths[i] - 26, h: st.h, font_array: digits('aod_stat'), h_space: 0,
        align_h: hmUI.align.LEFT, type: it.type,
        ...(it.unit ? units('font/aod_stat/pct.png') : {}),
        show_level: AOD
      })
      x += widths[i] + GAP
    })
  },

  // ---- values that need JS: rings, stand "now/goal", colour states ----
  bindSensors() {
    this.battery = new Battery()
    this.step = new Step()
    this.calorie = new Calorie()
    this.stand = new Stand()
    this.stress = new Stress()
    this.heartRate = new HeartRate()
    this.bloodOxygen = new BloodOxygen()
    this.sleep = new Sleep()
    this.time = new Time()
    this.weather = new Weather()
    let age = 0
    try {
      age = getProfile().age
    } catch (e) {
      // profile permission not granted: fall back to a generic max HR
    }
    this.maxHr = age > 0 ? 220 - age : 190

    this.onActivity = () => this.refreshActivity()
    this.onBattery = () => this.refreshBattery()
    this.onStress = () => this.refreshStress()
    this.onHealth = () => this.refreshHealth()
    this.step.onChange(this.onActivity)
    this.calorie.onChange(this.onActivity)
    this.stand.onChange(this.onActivity)
    this.battery.onChange(this.onBattery)
    this.stress.onChange(this.onStress)
    this.heartRate.onLastChange(this.onHealth)
    this.bloodOxygen.onChange(this.onHealth)
    this.time.onPerMinute(() => this.refreshAccent())
    this.refresh()
  },

  // Every wrist raise / return to the face
  refresh() {
    this.safely('sleep', () => this.sleep.updateInfo())
    this.readSunTimes()
    this.safely('rings', () => this.refreshActivity())
    this.safely('batt', () => this.refreshBattery())
    this.safely('stress', () => this.refreshStress())
    this.safely('health', () => this.refreshHealth())
    this.safely('accent', () => this.refreshAccent())
    this.safely('beat', () => this.heartbeat())
    this.showErrors()
  },

  refreshActivity() {
    const standNow = this.stand.getCurrent()
    const standGoal = this.stand.getTarget()
    this.ringLevels = [
      pctOf(this.step.getCurrent(), this.step.getTarget()),
      pctOf(this.calorie.getCurrent(), this.calorie.getTarget()),
      pctOf(standNow, standGoal)
    ]
    this.rings.forEach((set, i) => set(this.ringLevels[i]))
    this.standText.setProperty(hmUI.prop.TEXT, `${standNow}.${standGoal}`)
  },

  refreshBattery() {
    const level = this.battery.getCurrent()
    if (this.showBattery) {
      const tier = level <= BATTERY_CRITICAL ? 'red' : level <= BATTERY_LOW ? 'amber' : 'good'
      this.showBattery(tier === 'good' ? 'batt' : `batt_${tier}`, String(level))
      this.batteryIcon.setProperty(hmUI.prop.SRC, `icon/battery/${tier}_${Math.round(clamp(level, 0, 100) / 25) * 25}.png`)
    }
  },

  refreshStress() {
    const { value } = this.stress.getCurrent()
    // 1-100 is a reading; 0 and 255 (watch not worn) mean no data
    if (!(value > 0 && value <= 100)) {
      this.showStress(null)
      this.stressIcon.setProperty(hmUI.prop.SRC, 'icon/stress.png')
      return
    }
    const zone = stressZone(value)
    this.showStress(`tile_${zone}`, String(value))
    this.stressIcon.setProperty(hmUI.prop.SRC, `icon/stress_${zone}.png`)
  },

  refreshHealth() {
    const hr = this.heartRate.getLast()
    if (hr > 0 && hr < 255) {
      const f = hr / this.maxHr
      this.showHr(f >= HR_HIGH ? 'tile_red' : f >= HR_ELEVATED ? 'tile_orange' : 'tile', String(hr))
    } else {
      this.showHr(null)
    }

    const { value: spo2 } = this.bloodOxygen.getCurrent()
    if (spo2 > 0 && spo2 <= 100) this.showSpo2(spo2 < SPO2_LOW ? 'tile_red' : 'tile', String(spo2))
    else this.showSpo2(null)

    const { totalTime } = this.sleep.getInfo()
    if (totalTime > 0) {
      const text = `${Math.floor(totalTime / 60)}.${pad2(totalTime % 60)}`
      this.showSleep(totalTime < SLEEP_SHORT ? 'tile_amber' : 'tile', text)
    } else {
      this.showSleep(null)
    }
  },

  // Today's sunrise/sunset from the weather data; 06:00 / 18:00 without it
  readSunTimes() {
    this.sunrise = 6 * 60
    this.sunset = 18 * 60
    try {
      const forecast = this.weather.getForecastWeather ? this.weather.getForecastWeather() : this.weather.getForecast()
      const today = forecast.tideData.data[0]
      this.sunrise = today.sunrise.hour * 60 + today.sunrise.minute
      this.sunset = today.sunset.hour * 60 + today.sunset.minute
    } catch (e) {
      // no weather synced yet
    }
  },

  // Weekday colour: dawn (sunrise +/- 1 h), day, dusk (sunset +/- 1 h), night
  refreshAccent() {
    const now = this.time.getHours() * 60 + this.time.getMinutes()
    let phase = 'night'
    if (Math.abs(now - this.sunrise) <= 60) phase = 'dawn'
    else if (Math.abs(now - this.sunset) <= 60) phase = 'dusk'
    else if (now > this.sunrise && now < this.sunset) phase = 'day'
    this.weekday.setProperty(hmUI.prop.SRC, `date/week_${phase}_${this.time.getDay() - 1}.png`)
  },

  // ~3 s of "lub-dub" at the current heart rate
  heartbeat() {
    if (!this.heartAnim || !hmUI.anim_status) return
    const bpm = this.heartRate.getLast() > 0 ? this.heartRate.getLast() : 72
    const fps = clamp(Math.round((M.heartbeat.frames * bpm) / 60), 4, 24)
    const beats = Math.max(1, Math.round((3 * bpm) / 60))
    try {
      this.heartAnim.setProperty(hmUI.prop.ANIM_STATUS, hmUI.anim_status.STOP)
    } catch (e) {
      // not running yet
    }
    this.heartAnim.setProperty(hmUI.prop.MORE, { anim_fps: fps, repeat_count: beats })
    this.heartAnim.setProperty(hmUI.prop.ANIM_STATUS, hmUI.anim_status.START)
  },

  onInit() {},

  build() {
    this.init_view()
  },

  onDestroy() {
    // Only the sensors this mode created exist (the always-on scene has just battery)
    const off = (sensor, fn, method = 'offChange') => sensor && fn && sensor[method](fn)
    this.safely('destroy', () => {
      off(this.step, this.onActivity)
      off(this.calorie, this.onActivity)
      off(this.stand, this.onActivity)
      off(this.battery, this.onBattery)
      off(this.stress, this.onStress)
      off(this.heartRate, this.onHealth, 'offLastChange')
      off(this.bloodOxygen, this.onHealth)
    })
  }
})
