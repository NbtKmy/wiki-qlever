import './style.css'
import { mountPicker, type PickedPhoto } from './pickerScreen'

const app = document.getElementById('app')!
let dispose: (() => void) | null = null

function showPicker() {
  dispose?.()
  dispose = mountPicker(app, showAdjust)
}

async function showAdjust(photo: PickedPhoto) {
  dispose?.()
  dispose = null
  app.textContent = 'Loading the 3D scene…'
  // Cesium is large, so it is loaded only when the adjust screen is opened.
  const { mountAdjust } = await import('./adjustScreen')
  const handle = await mountAdjust(app, photo, showPicker)
  dispose = handle.dispose
}

showPicker()
