import { Battery, Step, Calorie, Stand, Stress, HeartRate, BloodOxygen, Sleep, Time, Weather } from '@zos/sensor'
import { getProfile } from '@zos/user'
import {
  launchApp,
  SYSTEM_APP_STATUS,
  SYSTEM_APP_HR,
  SYSTEM_APP_SPO2,
  SYSTEM_APP_SLEEP,
  SYSTEM_APP_PRESSURE,
  SYSTEM_APP_WEATHER
} from '@zos/router'
import * as zosUI from '@zos/ui'
import { M } from './metrics'

// Layout follows the approved wireframe: 390 x 450, all coordinates in px.
// Images live in assets/bip6 and are produced by tools/gen_assets.py.

// Watchface widgets are documented on the global hmUI; API 2+ apps are told to
// import @zos/ui instead. Use the global when the runtime provides it, else
// the module, with fallbacks for the watchface-only constants.
const hmUI = typeof globalThis.hmUI === 'object' && globalThis.hmUI !== null ? globalThis.hmUI : zosUI
const SHOW_LEVEL = hmUI.show_level || { ONLY_NORMAL: 1, ONAL_AOD: 2 }
const NORMAL = SHOW_LEVEL.ONLY_NORMAL
const AOD = SHOW_LEVEL.ONAL_AOD
const LINE = 0x2a2a30
const RING_TRACK = 0x2a2a30
const BAR_STEPS = 10

const digits = (set) => Array.from({ length: 10 }, (_, i) => `font/${set}/${i}.png`)
const words = (set, n) => Array.from({ length: n }, (_, i) => `date/${set}_${i}.png`)
const units = (src) => ({ unit_en: src, unit_sc: src, unit_tc: src, imperial_unit_en: src, imperial_unit_sc: src, imperial_unit_tc: src })
const barSrc = (name, pct) => `bar/${name}/${Math.max(0, Math.min(BAR_STEPS, Math.round((pct / 100) * BAR_STEPS)))}.png`
const pctOf = (cur, target) => (target > 0 ? Math.min(100, (cur * 100) / target) : 0)
const pad2 = (n) => String(n).padStart(2, '0')
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Thresholds agreed in the design
const SPO2_LOW = 92 // % - below this SpO2 turns red
const SLEEP_SHORT = 6 * 60 // minutes - under this sleep turns amber
const HR_ELEVATED = 0.6 // fraction of max HR (220 - age) where HR turns orange
const HR_HIGH = 0.8 // ... and red
const stressZone = (v) => (v < 40 ? 'relaxed' : v < 60 ? 'normal' : v < 80 ? 'medium' : 'high')

// HybridCharge is a newer data field; its data_type constant isn't in the
// published API reference yet, so look it up by name at runtime.
function findDataType(pattern) {
  const key = Object.keys(hmUI.data_type).find((k) => pattern.test(k))
  return key === undefined ? undefined : hmUI.data_type[key]
}

function img(x, y, src, show_level = NORMAL) {
  return hmUI.createWidget(hmUI.widget.IMG, { x, y, src, show_level })
}

function hline(y) {
  hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 24, y, w: 342, h: 1, color: LINE, show_level: NORMAL })
}

function vline(x, y, h) {
  hmUI.createWidget(hmUI.widget.FILL_RECT, { x, y, w: 1, h, color: LINE, show_level: NORMAL })
}

function value(set, opts) {
  return hmUI.createWidget(hmUI.widget.TEXT_IMG, {
    font_array: digits(set),
    h_space: 0,
    align_h: hmUI.align.LEFT,
    h: M[set].h,
    show_level: NORMAL,
    ...opts
  })
}

function tap(x, y, w, h, overlay, appId) {
  hmUI.createWidget(hmUI.widget.BUTTON, {
    x,
    y,
    w,
    h,
    text: '',
    normal_src: `press/${overlay}.png`,
    press_src: `press/${overlay}_press.png`,
    show_level: NORMAL,
    click_func: () => launchApp({ appId, native: true })
  })
}

function ring(cx, cy, radius, color) {
  const base = { center_x: cx, center_y: cy, radius, start_angle: -90, end_angle: 270, line_width: 9, show_level: NORMAL }
  hmUI.createWidget(hmUI.widget.ARC_PROGRESS, { ...base, color: RING_TRACK, level: 100 })
  const arc = hmUI.createWidget(hmUI.widget.ARC_PROGRESS, { ...base, color, level: 0 })
  return (level) => arc.setProperty(hmUI.prop.MORE, { ...base, color, level: Math.round(level) })
}

// One value drawn in one of several colours: a TEXT_IMG per colour set at
// the same spot, only the active one visible. show(null) shows "--".
// (An empty-text TEXT_IMG still draws "0" on the watch, so inactive copies
// are hidden rather than blanked.)
function tintedValue(sets, optsFor, invalidSrc, x, y) {
  const widgets = {}
  sets.forEach((set) => {
    widgets[set] = value(set, { x, y, w: 80, ...optsFor(set), text: '0' })
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
    hmUI.createWidget(hmUI.widget.IMG_WEEK, {
      x: pos.week.x,
      y: pos.week.y,
      week_en: words(sets.week, 7),
      week_tc: words(sets.week, 7),
      week_sc: words(sets.week, 7),
      show_level
    })
  }
  hmUI.createWidget(hmUI.widget.IMG_DATE, {
    day_startX: pos.day.x,
    day_startY: pos.day.y,
    day_is_character: true,
    day_en_array: words(sets.day, 31),
    day_sc_array: words(sets.day, 31),
    day_tc_array: words(sets.day, 31),
    show_level
  })
  hmUI.createWidget(hmUI.widget.IMG_DATE, {
    month_startX: pos.month.x,
    month_startY: pos.month.y,
    month_is_character: true,
    month_en_array: words(sets.month, 12),
    month_sc_array: words(sets.month, 12),
    month_tc_array: words(sets.month, 12),
    show_level
  })
}

WatchFace({
  init_view() {
    this.errors = []
    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: 390, h: 450, color: 0x000000 })

    // Each part is built on its own so one failure can't blank the face
    this.safely('activity', () => this.buildActivity())
    this.safely('status', () => this.buildStatus())
    this.safely('battery', () => this.buildBattery())
    this.safely('lines', () => [140, 322, 372].forEach(hline))
    this.safely('time', () => this.buildTime())
    this.safely('date', () => this.buildDate())
    this.safely('weather', () => this.buildWeather())
    this.safely('tiles', () => this.buildHealthTiles())
    this.safely('bottom', () => this.buildEnergyStress())
    this.safely('aod', () => this.buildAod())
    this.safely('sensors', () => this.bindSensors())
    this.safely('delegate', () =>
      hmUI.createWidget(hmUI.widget.WIDGET_DELEGATE, {
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
      this.errorText = hmUI.createWidget(hmUI.widget.TEXT, {
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
    this.setStepRing = ring(64, 78, 45, 0x2ee6ff)
    this.setCalRing = ring(64, 78, 34, 0xff5a36)
    this.setStandRing = ring(64, 78, 23, 0xb6f23a)

    const rowY = (i) => 26 + i * 26
    const valY = (i) => rowY(i) + Math.round((23 - M.stat.h) / 2)
    ;['steps', 'cal', 'stand', 'dist'].forEach((name, i) => img(120, rowY(i), `icon/${name}.png`))

    value('stat', { x: 148, y: valY(0), w: 72, type: hmUI.data_type.STEP })
    value('stat', { x: 148, y: valY(1), w: 72, type: hmUI.data_type.CAL })
    // Stand shows "now/goal": the dot image is a slash, fed as "8.12".
    this.standText = value('stat', { x: 148, y: valY(2), w: 72, dot_image: 'font/stat/slash.png', text: '0' })
    value('stat', { x: 148, y: valY(3), w: 72, type: hmUI.data_type.DISTANCE, dot_image: 'font/stat/dot.png' })

    tap(14, 26, 198, 102, 'activity', SYSTEM_APP_STATUS)
    vline(226, 30, 98)
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
      hmUI.createWidget(hmUI.widget.IMG_STATUS, {
        x: 244 + Math.round(i * (118 - 24) / 3),
        y: 30,
        type,
        src: `icon/${name}.png`,
        show_level: NORMAL
      })
    })
  },

  // ---- top right: battery ----
  buildBattery() {
    img(244, 65, 'icon/battery.png')
    value('batt', {
      x: 282,
      y: 80 - Math.round(M.batt.h / 2),
      w: 3 * M.batt.digit_w + M.batt.pct,
      type: hmUI.data_type.BATTERY,
      ...units('font/batt/pct.png')
    })
    this.batteryBar = img(244, 106, barSrc('battery', 0))
  },

  // ---- middle: time ----
  buildTime() {
    const width = 4 * M.time.digit_w + M.time.colon
    hmUI.createWidget(hmUI.widget.IMG_TIME, {
      hour_zero: 1,
      hour_startX: Math.round((390 - width) / 2),
      hour_startY: 150,
      hour_array: digits('time'),
      hour_space: 0,
      hour_unit_sc: 'font/time/colon.png',
      hour_unit_tc: 'font/time/colon.png',
      hour_unit_en: 'font/time/colon.png',
      hour_align: hmUI.align.LEFT,
      minute_zero: 1,
      minute_array: digits('time'),
      minute_space: 0,
      minute_follow: 1,
      show_level: NORMAL
    })
  },

  // ---- middle: date (positions computed by gen_assets.py) ----
  buildDate() {
    const R = M.dateRow
    // Weekday is drawn by refreshAccent(): its colour follows the time of day
    this.weekday = img(R.week.x, R.week.y, 'date/week_day_0.png')
    dateGroup({ day: 'day', month: 'month' }, R, NORMAL)
  },

  // ---- middle: weather, five equal columns ----
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
      ['hum', { type: hmUI.data_type.HUMIDITY, invalid_image: 'font/wx/invalid.png', ...units('font/wx/pct.png') }],
      ['uv', { type: hmUI.data_type.UVI, invalid_image: 'font/wx/invalid.png' }]
    ]
    fields.forEach(([key, opts]) => {
      const icon = R[`${key}Icon`]
      img(icon.x, icon.y, icon.src)
      value('wx', { ...R[key], ...opts })
    })
    tap(R.tap.x, R.tap.y, R.tap.w, R.tap.h, 'weather', SYSTEM_APP_WEATHER)
  },

  // ---- health tiles: HR, SpO2, sleep; icon beside value, colour by state ----
  buildHealthTiles() {
    const unitsIn = (set) => units(`font/${set}/pct.png`)
    const hr = M.tiles.hr
    const hb = M.heartbeat
    this.heartAnim = hmUI.createWidget(hmUI.widget.IMG_ANIM, {
      x: hr.iconX - hb.pad,
      y: hr.iconY - hb.pad,
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
    this.showHr = tintedValue(['tile', 'tile_orange', 'tile_red'], () => ({}), 'font/tile/invalid.png', hr.x, hr.y)

    const spo2 = M.tiles.spo2
    img(spo2.iconX, spo2.iconY, 'icon/spo2.png')
    this.showSpo2 = tintedValue(['tile', 'tile_red'], unitsIn, 'font/tile/invalid.png', spo2.x, spo2.y)

    // Sleep is "HH.MM" with the dot image drawn as a colon
    const sleep = M.tiles.sleep
    img(sleep.iconX, sleep.iconY, 'icon/sleep.png')
    this.showSleep = tintedValue(
      ['tile', 'tile_amber'],
      (set) => ({ dot_image: `font/${set}/colon.png` }),
      'font/tile/invalid.png',
      sleep.x,
      sleep.y
    )

    const apps = { hr: SYSTEM_APP_HR, spo2: SYSTEM_APP_SPO2, sleep: SYSTEM_APP_SLEEP }
    Object.keys(apps).forEach((key, i) => {
      const col = M.tiles[key].col
      tap(col, 328, 114, 36, 'tile', apps[key])
      if (i) vline(col, 332, 28)
    })
  },

  // ---- bottom: HybridCharge + stress, each with a bar ----
  buildEnergyStress() {
    const cy = 400
    const valueY = cy - Math.round(M.bot.h / 2)
    const iconY = cy - 13
    const barY = cy - 4
    const cols = [36, 204]

    img(cols[0], iconY, 'icon/hybrid.png')
    const hybridType = findDataType(/HYBRID|BIO_?CHARGE/i)
    if (hybridType !== undefined) {
      value('bot', { x: cols[0] + 32, y: valueY, w: 46, type: hybridType, invalid_image: 'font/bot/invalid.png' })
      hmUI.createWidget(hmUI.widget.IMG_LEVEL, {
        x: cols[0] + 82,
        y: barY,
        image_array: Array.from({ length: BAR_STEPS + 1 }, (_, i) => `bar/hybrid/${i}.png`),
        image_length: BAR_STEPS + 1,
        type: hybridType,
        show_level: NORMAL
      })
    } else {
      // Firmware without HybridCharge: show "--" and an empty bar
      img(cols[0] + 32, valueY, 'font/bot/invalid.png')
      img(cols[0] + 82, barY, barSrc('hybrid', 0))
    }

    // Stress: icon, value and bar all take the zone colour
    this.stressIcon = img(cols[1], iconY, 'icon/stress.png')
    const zones = ['relaxed', 'normal', 'medium', 'high']
    this.showStress = tintedValue(zones.map((z) => `bot_${z}`), () => ({ w: 46 }), 'font/bot/invalid.png', cols[1] + 32, valueY)
    this.stressBar = img(cols[1] + 82, barY, barSrc('stress_relaxed', 0))
    tap(cols[1], cy - 20, 150, 40, 'stress', SYSTEM_APP_PRESSURE)
  },

  // ---- always-on display: dim time, date, battery ----
  buildAod() {
    const width = 4 * M.aod.digit_w + M.aod.colon
    hmUI.createWidget(hmUI.widget.IMG_TIME, {
      hour_zero: 1,
      hour_startX: Math.round((390 - width) / 2),
      hour_startY: 150,
      hour_array: digits('aod'),
      hour_space: 0,
      hour_unit_sc: 'font/aod/colon.png',
      hour_unit_tc: 'font/aod/colon.png',
      hour_unit_en: 'font/aod/colon.png',
      hour_align: hmUI.align.LEFT,
      minute_zero: 1,
      minute_array: digits('aod'),
      minute_space: 0,
      minute_follow: 1,
      show_level: AOD
    })

    const dateW = M.aod_week.w + 8 + M.aod_day.w + 8 + M.aod_month.w
    const dx = Math.round((390 - dateW) / 2)
    dateGroup(
      { week: 'aod_week', day: 'aod_day', month: 'aod_month' },
      {
        week: { x: dx, y: 258 },
        day: { x: dx + M.aod_week.w + 8, y: 258 },
        month: { x: dx + M.aod_week.w + 8 + M.aod_day.w + 8, y: 258 }
      },
      AOD
    )

    const battW = 46 + 8 + 2 * M.aod_batt.digit_w + M.aod_batt.pct
    const bx = Math.round((390 - battW) / 2)
    this.aodBatteryBar = img(bx, 336, barSrc('aod_battery', 0), AOD)
    hmUI.createWidget(hmUI.widget.TEXT_IMG, {
      x: bx + 54,
      y: 342 - Math.round(M.aod_batt.h / 2),
      w: 3 * M.aod_batt.digit_w + M.aod_batt.pct,
      h: M.aod_batt.h,
      font_array: digits('aod_batt'),
      h_space: 0,
      align_h: hmUI.align.LEFT,
      type: hmUI.data_type.BATTERY,
      ...units('font/aod_batt/pct.png'),
      show_level: AOD
    })
  },

  // ---- values that need JS: rings, stand "now/goal", bars, colour states ----
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
    this.setStepRing(pctOf(this.step.getCurrent(), this.step.getTarget()))
    this.setCalRing(pctOf(this.calorie.getCurrent(), this.calorie.getTarget()))
    const standNow = this.stand.getCurrent()
    const standGoal = this.stand.getTarget()
    this.setStandRing(pctOf(standNow, standGoal))
    this.standText.setProperty(hmUI.prop.TEXT, `${standNow}.${standGoal}`)
  },

  refreshBattery() {
    const level = this.battery.getCurrent()
    this.batteryBar.setProperty(hmUI.prop.SRC, barSrc('battery', level))
    this.aodBatteryBar.setProperty(hmUI.prop.SRC, barSrc('aod_battery', level))
  },

  refreshStress() {
    const { value } = this.stress.getCurrent()
    if (!(value > 0)) {
      this.showStress(null)
      this.stressIcon.setProperty(hmUI.prop.SRC, 'icon/stress.png')
      this.stressBar.setProperty(hmUI.prop.SRC, barSrc('stress_relaxed', 0))
      return
    }
    const zone = stressZone(value)
    this.showStress(`bot_${zone}`, String(value))
    this.stressIcon.setProperty(hmUI.prop.SRC, `icon/stress_${zone}.png`)
    this.stressBar.setProperty(hmUI.prop.SRC, barSrc(`stress_${zone}`, value))
  },

  refreshHealth() {
    const hr = this.heartRate.getLast()
    if (hr > 0) {
      const f = hr / this.maxHr
      this.showHr(f >= HR_HIGH ? 'tile_red' : f >= HR_ELEVATED ? 'tile_orange' : 'tile', String(hr))
    } else {
      this.showHr(null)
    }

    const { value: spo2 } = this.bloodOxygen.getCurrent()
    if (spo2 > 0) this.showSpo2(spo2 < SPO2_LOW ? 'tile_red' : 'tile', String(spo2)) // widget appends the % unit
    else this.showSpo2(null)

    const { totalTime } = this.sleep.getInfo()
    if (totalTime > 0) {
      const text = `${pad2(Math.floor(totalTime / 60))}.${pad2(totalTime % 60)}`
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
    this.safely('destroy', () => {
      this.step.offChange(this.onActivity)
      this.calorie.offChange(this.onActivity)
      this.stand.offChange(this.onActivity)
      this.battery.offChange(this.onBattery)
      this.stress.offChange(this.onStress)
      this.heartRate.offLastChange(this.onHealth)
      this.bloodOxygen.offChange(this.onHealth)
    })
  }
})
