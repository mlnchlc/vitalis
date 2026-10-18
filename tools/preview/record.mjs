// Runs watchface/index.js against a stub hmUI and prints every widget it
// creates (with later setProperty changes applied) as JSON, for render.py.
//   node tools/preview/record.mjs > widgets.json
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Sample values the stub sensors report. PREVIEW_SAMPLE='{"hr":165,...}'
// overrides any of them (used for the alert-state render).
const SAMPLE = {
  step: [7486, 10000],
  calorie: [412, 600],
  stand: [8, 12],
  battery: 62,
  stress: 32,
  hr: 74,
  spo2: 98,
  sleep: 452,
  age: 30,
  time: [10, 8],
  weekday: 6,
  sun: [[6, 23], [17, 49]],
  ...JSON.parse(process.env.PREVIEW_SAMPLE || '{}')
}

const widgets = []
const enumOf = (names) => Object.fromEntries(names.map((n) => [n, n]))

globalThis.hmUI = {
  widget: enumOf(['IMG', 'TEXT', 'TEXT_IMG', 'FILL_RECT', 'BUTTON', 'ARC_PROGRESS', 'IMG_TIME', 'IMG_WEEK', 'IMG_DATE', 'IMG_LEVEL', 'IMG_STATUS', 'IMG_ANIM', 'WIDGET_DELEGATE']),
  data_type: enumOf(['STEP', 'CAL', 'DISTANCE', 'BATTERY', 'WEATHER_CURRENT', 'WEATHER_HIGH', 'WEATHER_LOW', 'HUMIDITY', 'HEART', 'SPO2', 'SLEEP', 'STRESS', 'UVI', 'BIO_CHARGE']),
  align: enumOf(['LEFT', 'RIGHT', 'CENTER_H']),
  prop: enumOf(['TEXT', 'SRC', 'MORE', 'VISIBLE', 'ANIM_STATUS']),
  anim_status: enumOf(['START', 'PAUSE', 'RESUME', 'STOP']),
  show_level: { ONLY_NORMAL: 1, ONAL_AOD: 2 },
  system_status: enumOf(['DISCONNECT', 'DISTURB', 'CLOCK', 'LOCK']),
  createWidget(type, opts = {}) {
    const w = { ...opts, widget: type }
    widgets.push(w)
    return {
      setProperty(prop, v) {
        if (prop === 'TEXT') w.text = v
        else if (prop === 'SRC') w.src = v
        else if (prop === 'MORE') Object.assign(w, v)
        else if (prop === 'VISIBLE') w.visible = v
      }
    }
  }
}

let face
globalThis.WatchFace = (def) => { face = def }

const sensor = (cur, target) => class {
  getCurrent() { return cur }
  getTarget() { return target }
  onChange() {}
  offChange() {}
}
const sensors = {
  Step: sensor(...SAMPLE.step),
  Calorie: sensor(...SAMPLE.calorie),
  Stand: sensor(...SAMPLE.stand),
  Battery: sensor(SAMPLE.battery),
  Stress: sensor({ value: SAMPLE.stress, time: 0 }),
  BloodOxygen: sensor({ value: SAMPLE.spo2, time: 0, retCode: 2 }),
  HeartRate: class {
    getLast() { return SAMPLE.hr }
    onLastChange() {}
    offLastChange() {}
  },
  Sleep: class {
    updateInfo() {}
    getInfo() { return { totalTime: SAMPLE.sleep, score: 80 } }
  },
  Time: class {
    getHours() { return SAMPLE.time[0] }
    getMinutes() { return SAMPLE.time[1] }
    getDay() { return SAMPLE.weekday }
    onPerMinute() {}
  },
  Weather: class {
    getForecastWeather() {
      const [[rh, rm], [sh, sm]] = SAMPLE.sun
      return { tideData: { count: 1, data: [{ sunrise: { hour: rh, minute: rm }, sunset: { hour: sh, minute: sm } }] } }
    }
  }
}
globalThis.__user = { getProfile: () => ({ age: SAMPLE.age }) }
// PREVIEW_SCENE=aod starts the face as the always-on screen
globalThis.__app = { getScene: () => (process.env.PREVIEW_SCENE === 'aod' ? 4 : 2), SCENE_AOD: 4 }
// PREVIEW_NO_SHOW_LEVEL=1 mimics the Bip 6, whose @zos/ui has no show_level
if (process.env.PREVIEW_NO_SHOW_LEVEL) delete globalThis.hmUI.show_level
globalThis.__sensors = sensors

// Swap the platform imports for the stubs above, keep everything else as is.
const dir = mkdtempSync(join(tmpdir(), 'wf-preview-'))
let src = readFileSync(join(root, 'watchface', 'index.js'), 'utf8')
src = src
  .replace(/import \{([^}]*)\} from '@zos\/sensor'/, 'const {$1} = globalThis.__sensors')
  .replace(/import \{([^}]*)\} from '@zos\/user'/, 'const {$1} = globalThis.__user')
  .replace("import * as zosUI from '@zos/ui'", 'const zosUI = globalThis.hmUI')
  .replace(/import \{([^}]*)\} from '@zos\/app'/, 'const {$1} = globalThis.__app')
  .replace(/import \{([^}]*)\} from '@zos\/router'/s, (_, names) =>
    `const {${names}} = { launchApp() {}, ${names.split(',').map((n) => n.trim()).filter(Boolean).filter((n) => n !== 'launchApp').map((n) => `${n}: '${n}'`).join(', ')} }`)
  .replace("from './metrics'", `from '${pathToFileURL(join(root, 'watchface', 'metrics.js')).href}'`)
writeFileSync(join(dir, 'index.mjs'), src)
await import(pathToFileURL(join(dir, 'index.mjs')).href)

face.build()
const [hh, mm] = SAMPLE.time
widgets.time = `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`
process.stdout.write(JSON.stringify({ time: widgets.time, widgets: widgets.map(({ click_func, resume_call, anim_complete_call, ...w }) => w) }, null, 1))
