// Runs watchface/index.js against a stub hmUI and prints every widget it
// creates (with later setProperty changes applied) as JSON, for render.py.
//   node tools/preview/record.mjs > widgets.json
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Sample values the stub sensors report
const SAMPLE = {
  step: [7486, 10000],
  calorie: [412, 600],
  stand: [8, 12],
  battery: 62,
  stress: 32
}

const widgets = []
const enumOf = (names) => Object.fromEntries(names.map((n) => [n, n]))

globalThis.hmUI = {
  widget: enumOf(['IMG', 'TEXT_IMG', 'FILL_RECT', 'BUTTON', 'ARC_PROGRESS', 'IMG_TIME', 'IMG_WEEK', 'IMG_DATE', 'IMG_LEVEL', 'WIDGET_DELEGATE']),
  data_type: enumOf(['STEP', 'CAL', 'DISTANCE', 'BATTERY', 'WEATHER_CURRENT', 'WEATHER_HIGH', 'WEATHER_LOW', 'HUMIDITY', 'HEART', 'SPO2', 'SLEEP', 'STRESS', 'HYBRID_CHARGE']),
  align: enumOf(['LEFT', 'RIGHT', 'CENTER_H']),
  prop: enumOf(['TEXT', 'SRC', 'MORE']),
  show_level: { ONLY_NORMAL: 1, ONAL_AOD: 2 },
  createWidget(type, opts = {}) {
    const w = { ...opts, widget: type }
    widgets.push(w)
    return {
      setProperty(prop, v) {
        if (prop === 'TEXT') w.text = v
        else if (prop === 'SRC') w.src = v
        else if (prop === 'MORE') Object.assign(w, v)
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
  Stress: sensor({ value: SAMPLE.stress, time: 0 })
}
globalThis.__sensors = sensors

// Swap the platform imports for the stubs above, keep everything else as is.
const dir = mkdtempSync(join(tmpdir(), 'wf-preview-'))
let src = readFileSync(join(root, 'watchface', 'index.js'), 'utf8')
src = src
  .replace(/import \{([^}]*)\} from '@zos\/sensor'/, 'const {$1} = globalThis.__sensors')
  .replace(/import \{([^}]*)\} from '@zos\/router'/s, (_, names) =>
    `const {${names}} = { launchApp() {}, ${names.split(',').map((n) => n.trim()).filter(Boolean).filter((n) => n !== 'launchApp').map((n) => `${n}: '${n}'`).join(', ')} }`)
  .replace("from './metrics'", `from '${pathToFileURL(join(root, 'watchface', 'metrics.js')).href}'`)
writeFileSync(join(dir, 'index.mjs'), src)
await import(pathToFileURL(join(dir, 'index.mjs')).href)

face.build()
process.stdout.write(JSON.stringify(widgets.map(({ click_func, resume_call, ...w }) => w), null, 1))
