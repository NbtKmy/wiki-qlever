import { commonsPageUrl } from './commons'
import { formatResult, metersBetween, offsetByMeters } from './geo'
import type { CameraPose, PoseStore } from './poseStore'

type Slider = { row: HTMLElement; update(value: number): void }

function slider(
  label: string,
  { min, max, step }: { min: number; max: number; step: number },
  unit: string,
  onInput: (value: number) => void,
): Slider {
  const row = document.createElement('label')
  row.className = 'panel-row'
  const name = document.createElement('span')
  name.textContent = label
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  const value = document.createElement('output')
  input.oninput = () => onInput(Number(input.value))
  row.append(name, input, value)
  return {
    row,
    update(v: number) {
      input.value = String(v)
      value.textContent = `${Number.isInteger(step) ? Math.round(v) : v.toFixed(1)} ${unit}`
    },
  }
}

/** Right-hand panel with sliders for fine tuning. Mounted into the element that holds the 3D view. */
export function mountPanel(
  root: HTMLElement,
  store: PoseStore,
  photoImg: HTMLImageElement,
  photoTitle: string,
): void {
  const start: CameraPose = store.get()
  const aside = document.createElement('aside')
  aside.className = 'adjust-panel'

  const toggle = document.createElement('button')
  toggle.className = 'panel-toggle'
  toggle.textContent = '–'
  toggle.title = 'Minimise the panel'
  toggle.onclick = () => {
    const collapsed = aside.classList.toggle('collapsed')
    toggle.textContent = collapsed ? '+' : '–'
    toggle.title = collapsed ? 'Show the panel' : 'Minimise the panel'
  }
  const body = document.createElement('div')
  body.className = 'panel-body'

  const offsets = () => metersBetween(start.position, store.get().position)
  const moveTo = (eastM: number, northM: number) =>
    store.set({ position: offsetByMeters(start.position, eastM, northM) })

  const opacity = slider('Photo opacity', { min: 0, max: 100, step: 1 }, '%', (v) => {
    photoImg.style.opacity = String(v / 100)
    opacity.update(v)
  })
  const eastWest = slider('East–west', { min: -100, max: 100, step: 1 }, 'm', (v) => moveTo(v, offsets().northM))
  const northSouth = slider('North–south', { min: -100, max: 100, step: 1 }, 'm', (v) => moveTo(offsets().eastM, v))
  const height = slider('Height above ground', { min: 0, max: 50, step: 0.1 }, 'm', (v) =>
    store.set({ heightAboveGroundM: v }),
  )
  const heading = slider('Heading', { min: 0, max: 359, step: 1 }, '°', (v) => store.set({ headingDeg: v }))
  const fov = slider('Field of view', { min: 10, max: 120, step: 1 }, '°', (v) => store.set({ fovDeg: v }))

  const heading3 = (text: string) => {
    const h = document.createElement('h3')
    h.textContent = text
    return h
  }
  const result = document.createElement('pre')
  result.className = 'panel-result'
  const copy = document.createElement('button')
  copy.textContent = 'Copy values'
  copy.onclick = async () => {
    const { position, headingDeg } = store.get()
    await navigator.clipboard.writeText(formatResult(position, headingDeg).text)
    copy.textContent = 'Copied'
    setTimeout(() => (copy.textContent = 'Copy values'), 1500)
  }
  const commonsLink = document.createElement('a')
  commonsLink.href = commonsPageUrl(photoTitle)
  commonsLink.target = '_blank'
  commonsLink.rel = 'noopener'
  commonsLink.textContent = 'Open on Commons'

  body.append(
    heading3('Photo'),
    opacity.row,
    heading3('Camera'),
    eastWest.row,
    northSouth.row,
    height.row,
    heading.row,
    fov.row,
    heading3('Result'),
    result,
    copy,
    document.createTextNode(' '),
    commonsLink,
  )
  aside.append(toggle, body)
  root.append(aside)

  const sync = (pose: CameraPose) => {
    const { eastM, northM } = metersBetween(start.position, pose.position)
    eastWest.update(eastM)
    northSouth.update(northM)
    height.update(pose.heightAboveGroundM)
    heading.update(pose.headingDeg)
    fov.update(pose.fovDeg)
    result.textContent = formatResult(pose.position, pose.headingDeg).text
  }
  opacity.update(Number(photoImg.style.opacity) * 100)
  sync(store.get())
  store.subscribe(sync)
}
