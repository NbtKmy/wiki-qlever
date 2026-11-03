import './style.css'
import { mountPicker, type PickedPhoto } from './pickerScreen'

const app = document.getElementById('app')!
let dispose: (() => void) | null = null

function showPicker() {
  dispose?.()
  dispose = mountPicker(app, showAdjust)
}

// Replaced by the real adjust screen in Task 5.
function showAdjust(photo: PickedPhoto) {
  dispose?.()
  dispose = null
  const back = document.createElement('button')
  back.textContent = '← Back to list'
  back.onclick = showPicker
  app.replaceChildren(back, document.createTextNode(` Picked: ${photo.title}`))
}

showPicker()
