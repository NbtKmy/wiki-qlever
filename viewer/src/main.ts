import './style.css'
import { mountPicker, type PickedPhoto } from './pickerScreen'

const app = document.getElementById('app')!
let dispose: (() => void) | null = null
// Bumped on every screen change, so a slow 3D scene that finishes after "Back" is thrown away.
let screen = 0

function showPicker() {
  screen++
  dispose?.()
  dispose = mountPicker(app, showAdjust)
}

async function showAdjust(photo: PickedPhoto) {
  const mine = ++screen
  dispose?.()
  dispose = null
  const host = document.createElement('div')
  host.className = 'adjust-host'
  host.textContent = 'Loading the 3D scene…'
  app.replaceChildren(host)
  try {
    // Cesium is large, so it is loaded only when the adjust screen is opened.
    const { mountAdjust } = await import('./adjustScreen')
    const handle = await mountAdjust(host, photo, showPicker)
    if (mine !== screen) {
      handle.dispose()
      return
    }
    dispose = handle.dispose
  } catch (error) {
    if (mine !== screen) return
    const message = document.createElement('p')
    message.textContent = `Could not load the 3D scene: ${error instanceof Error ? error.message : String(error)}.`
    const retry = document.createElement('button')
    retry.textContent = 'Retry'
    retry.onclick = () => void showAdjust(photo)
    const back = document.createElement('button')
    back.textContent = '← Back to list'
    back.onclick = showPicker
    host.replaceChildren(message, retry, back)
  }
}

showPicker()
