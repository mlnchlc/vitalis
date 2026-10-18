import { Battery, Step, Calorie, Stand, Stress } from '@zos/sensor'
import {
  launchApp,
  SYSTEM_APP_STATUS,
  SYSTEM_APP_HR,
  SYSTEM_APP_SPO2,
  SYSTEM_APP_SLEEP,
  SYSTEM_APP_PRESSURE,
  SYSTEM_APP_WEATHER
} from '@zos/router'
import { M } from './metrics'

// Layout follows the approved wireframe: 390 x 450, all coordinates in px.
// Images live in assets/bip6 and are produced by tools/gen_assets.py.

const NORMAL = hmUI.show_level.ONLY_NORMAL
const AOD = hmUI.show_level.ONAL_AOD
const LINE = 0x2a2a30
const RING_TRACK = 0x2a2a30
const BAR_STEPS = 10

const digits = (set) => Array.from({ length: 10 }, (_, i) => `font/${set}/${i}.png`)
const words = (set, n) => Array.from({ length: n }, (_, i) => `date/${set}_${i}.png`)
const units = (src) => ({ unit_en: src, unit_sc: src, unit_tc: src, imperial_unit_en: src, imperial_unit_sc: src, imperial_unit_tc: src })
const barSrc = (name, pct) => `bar/${name}/${Math.max(0, Math.min(BAR_STEPS, Math.round((pct / 100) * BAR_STEPS)))}.png`
const pctOf = (cur, target) => (target > 0 ? Math.min(100, (cur * 100) / target) : 0)

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

WatchFace({
  init_view() {
    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: 390, h: 450, color: 0x000000 })

    this.buildActivity()
    this.buildBattery()
    hline(140)
    this.buildTime()
    this.buildDateWeather()
    hline(296)
    this.buildHealthTiles()
    hline(378)
    this.buildEnergyStress()
    this.buildAod()

    this.bindSensors()
    hmUI.createWidget(hmUI.widget.WIDGET_DELEGATE, {
      resume_call: () => this.refresh()
    })
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

  // ---- top right: battery ----
  buildBattery() {
    img(240, 42, 'icon/battery.png')
    value('batt', {
      x: 276,
      y: 57 - Math.round(M.batt.h / 2),
      w: 3 * M.batt.digit_w + M.batt.pct,
      type: hmUI.data_type.BATTERY,
      ...units('font/batt/pct.png')
    })
    this.batteryBar = img(240, 92, barSrc('battery', 0))
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

  // ---- date + weather row (positions computed by gen_assets.py) ----
  buildDateWeather() {
    const R = M.dateRow
    hmUI.createWidget(hmUI.widget.IMG_WEEK, {
      x: R.week.x,
      y: R.week.y,
      week_en: words('week', 7),
      week_tc: words('week', 7),
      week_sc: words('week', 7),
      show_level: NORMAL
    })
    // Days are whole pre-spaced images (1-31) rather than two digits
    hmUI.createWidget(hmUI.widget.IMG_DATE, {
      day_startX: R.day.x,
      day_startY: R.day.y,
      day_is_character: true,
      day_en_array: words('day', 31),
      day_sc_array: words('day', 31),
      day_tc_array: words('day', 31),
      show_level: NORMAL
    })
    hmUI.createWidget(hmUI.widget.IMG_DATE, {
      month_startX: R.month.x,
      month_startY: R.month.y,
      month_is_character: true,
      month_en_array: words('month', 12),
      month_sc_array: words('month', 12),
      month_tc_array: words('month', 12),
      show_level: NORMAL
    })

    const temp = {
      negative_image: 'font/row/minus.png',
      invalid_image: 'font/row/invalid.png',
      ...units('font/row/deg.png')
    }
    img(R.tempIcon.x, R.tempIcon.y, 'icon/temp.png')
    value('row', { ...R.temp, type: hmUI.data_type.WEATHER_CURRENT, ...temp })
    img(R.highIcon.x, R.highIcon.y, 'icon/high.png')
    value('row', { ...R.high, type: hmUI.data_type.WEATHER_HIGH, ...temp })
    img(R.lowIcon.x, R.lowIcon.y, 'icon/low.png')
    value('row', { ...R.low, type: hmUI.data_type.WEATHER_LOW, ...temp })
    img(R.humIcon.x, R.humIcon.y, 'icon/humidity.png')
    value('row', {
      ...R.hum,
      type: hmUI.data_type.HUMIDITY,
      invalid_image: 'font/row/invalid.png',
      ...units('font/row/pct.png')
    })

    const T = R.weatherTap
    tap(T.x, T.y, T.w, T.h, 'weather', SYSTEM_APP_WEATHER)
  },

  // ---- health tiles: HR, SpO2, sleep ----
  buildHealthTiles() {
    const tiles = [
      { icon: 'hr', type: hmUI.data_type.HEART, app: SYSTEM_APP_HR },
      { icon: 'spo2', type: hmUI.data_type.SPO2, app: SYSTEM_APP_SPO2, unit: 'font/tile/pct.png' },
      // SLEEP is HH:MM; the dot image doubles as the colon separator
      { icon: 'sleep', type: hmUI.data_type.SLEEP, app: SYSTEM_APP_SLEEP, dot: 'font/tile/colon.png' }
    ]
    tiles.forEach((t, i) => {
      const x = 24 + i * 114
      img(x + 42, 304, `icon/${t.icon}.png`)
      value('tile', {
        x,
        y: 340,
        w: 114,
        align_h: hmUI.align.CENTER_H,
        type: t.type,
        invalid_image: 'font/tile/invalid.png',
        ...(t.unit ? units(t.unit) : {}),
        ...(t.dot ? { dot_image: t.dot } : {})
      })
      tap(x, 304, 114, 68, 'tile', t.app)
      if (i) vline(x, 308, 60)
    })
  },

  // ---- bottom: HybridCharge + stress, each with a bar ----
  buildEnergyStress() {
    const valueY = 406 - Math.round(M.bot.h / 2)
    const cols = [36, 204]

    img(cols[0], 393, 'icon/hybrid.png')
    const hybridType = findDataType(/HYBRID|BIO_?CHARGE/i)
    if (hybridType !== undefined) {
      value('bot', { x: cols[0] + 32, y: valueY, w: 46, type: hybridType, invalid_image: 'font/bot/invalid.png' })
      hmUI.createWidget(hmUI.widget.IMG_LEVEL, {
        x: cols[0] + 82,
        y: 402,
        image_array: Array.from({ length: BAR_STEPS + 1 }, (_, i) => `bar/hybrid/${i}.png`),
        image_length: BAR_STEPS + 1,
        type: hybridType,
        show_level: NORMAL
      })
    } else {
      // Firmware without HybridCharge: show "--" and an empty bar
      img(cols[0] + 32, valueY, 'font/bot/invalid.png')
      img(cols[0] + 82, 402, barSrc('hybrid', 0))
    }

    img(cols[1], 393, 'icon/stress.png')
    value('bot', {
      x: cols[1] + 32,
      y: valueY,
      w: 46,
      type: hmUI.data_type.STRESS,
      invalid_image: 'font/bot/invalid.png'
    })
    this.stressBar = img(cols[1] + 82, 402, barSrc('stress', 0))
    tap(cols[1], 386, 150, 40, 'stress', SYSTEM_APP_PRESSURE)
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

    const dateW = M.aod_week.w + 8 + 2 * M.aod_date.digit_w + 8 + M.aod_month.w
    const dx = Math.round((390 - dateW) / 2)
    hmUI.createWidget(hmUI.widget.IMG_WEEK, {
      x: dx,
      y: 262,
      week_en: words('aod_week', 7),
      week_tc: words('aod_week', 7),
      week_sc: words('aod_week', 7),
      show_level: AOD
    })
    hmUI.createWidget(hmUI.widget.IMG_DATE, {
      day_startX: dx + M.aod_week.w + 8,
      day_startY: 262,
      day_zero: 1,
      day_space: 0,
      day_align: hmUI.align.LEFT,
      day_en_array: digits('aod_date'),
      day_sc_array: digits('aod_date'),
      day_tc_array: digits('aod_date'),
      show_level: AOD
    })
    hmUI.createWidget(hmUI.widget.IMG_DATE, {
      month_startX: dx + M.aod_week.w + 8 + 2 * M.aod_date.digit_w + 8,
      month_startY: 262,
      month_is_character: true,
      month_en_array: words('aod_month', 12),
      month_sc_array: words('aod_month', 12),
      month_tc_array: words('aod_month', 12),
      show_level: AOD
    })

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

  // ---- values that need JS: ring levels, stand "now/goal", bar images ----
  bindSensors() {
    this.battery = new Battery()
    this.step = new Step()
    this.calorie = new Calorie()
    this.stand = new Stand()
    this.stress = new Stress()

    this.onActivity = () => this.refreshActivity()
    this.onBattery = () => this.refreshBattery()
    this.onStress = () => this.refreshStress()
    this.step.onChange(this.onActivity)
    this.calorie.onChange(this.onActivity)
    this.stand.onChange(this.onActivity)
    this.battery.onChange(this.onBattery)
    this.stress.onChange(this.onStress)
    this.refresh()
  },

  refresh() {
    this.refreshActivity()
    this.refreshBattery()
    this.refreshStress()
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
    this.stressBar.setProperty(hmUI.prop.SRC, barSrc('stress', value || 0))
  },

  onInit() {},

  build() {
    this.init_view()
  },

  onDestroy() {
    this.step.offChange(this.onActivity)
    this.calorie.offChange(this.onActivity)
    this.stand.offChange(this.onActivity)
    this.battery.offChange(this.onBattery)
    this.stress.offChange(this.onStress)
  }
})
