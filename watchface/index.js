import { createWidget, widget, align, prop, text_style } from '@zos/ui'
import { Time, Battery, Step, HeartRate } from '@zos/sensor'
import { SCREEN_WIDTH, COLORS, WEEKDAYS, MONTHS } from '../utils/constants'

const pad = (n) => String(n).padStart(2, '0')

WatchFace({
  build() {
    this.time = new Time()
    this.battery = new Battery()
    this.step = new Step()
    this.heartRate = new HeartRate()

    createWidget(widget.FILL_RECT, {
      x: 0,
      y: 0,
      w: SCREEN_WIDTH,
      h: 450,
      color: COLORS.background
    })

    this.dateText = createWidget(widget.TEXT, {
      x: 0,
      y: 70,
      w: SCREEN_WIDTH,
      h: 40,
      color: COLORS.accent,
      text_size: 30,
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE
    })

    this.timeText = createWidget(widget.TEXT, {
      x: 0,
      y: 120,
      w: SCREEN_WIDTH,
      h: 150,
      color: COLORS.primary,
      text_size: 130,
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE
    })

    // Bottom row: steps | heart rate | battery
    const statY = 320
    const colW = SCREEN_WIDTH / 3
    const statLabel = (i, label) =>
      createWidget(widget.TEXT, {
        x: colW * i,
        y: statY + 44,
        w: colW,
        h: 30,
        color: COLORS.muted,
        text_size: 20,
        align_h: align.CENTER_H,
        text: label
      })
    const statValue = (i) =>
      createWidget(widget.TEXT, {
        x: colW * i,
        y: statY,
        w: colW,
        h: 44,
        color: COLORS.primary,
        text_size: 34,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V
      })

    this.stepText = statValue(0)
    this.hrText = statValue(1)
    this.batteryText = statValue(2)
    statLabel(0, 'STEPS')
    statLabel(1, 'BPM')
    statLabel(2, 'BATT')

    this.updateTime()
    this.updateStats()

    this.time.onPerMinute(() => this.updateTime())
    this.battery.onChange(() => this.updateStats())
    this.step.onChange(() => this.updateStats())
    this.heartRate.onLastChange(() => this.updateStats())
  },

  updateTime() {
    const t = this.time
    this.timeText.setProperty(prop.TEXT, `${pad(t.getHours())}:${pad(t.getMinutes())}`)
    const d = new Date()
    this.dateText.setProperty(prop.TEXT, `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`)
  },

  updateStats() {
    this.stepText.setProperty(prop.TEXT, `${this.step.getCurrent()}`)
    const hr = this.heartRate.getLast()
    this.hrText.setProperty(prop.TEXT, hr > 0 ? `${hr}` : '--')
    this.batteryText.setProperty(prop.TEXT, `${this.battery.getCurrent()}%`)
  },

  onDestroy() {}
})
