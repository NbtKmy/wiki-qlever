import { walk } from './geo'
import type { AdjustHandle } from './adjustScreen'

type Target = Pick<AdjustHandle, 'viewer' | 'store' | 'ground' | 'sampleGround'>

const WALK_SPEED_M_PER_S = 2
const LOOK_DEG_PER_PX = 0.1
const FOV_DEG_PER_WHEEL_UNIT = 0.05
const GROUND_SAMPLE_INTERVAL_MS = 200

const KEY_DIRECTIONS: Record<string, { forward: number; right: number }> = {
  ArrowUp: { forward: 1, right: 0 },
  w: { forward: 1, right: 0 },
  ArrowDown: { forward: -1, right: 0 },
  s: { forward: -1, right: 0 },
  ArrowLeft: { forward: 0, right: -1 },
  a: { forward: 0, right: -1 },
  ArrowRight: { forward: 0, right: 1 },
  d: { forward: 0, right: 1 },
}

const isFormField = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement

/**
 * Drag to look around (the scene follows the mouse), arrow keys or WASD to walk, wheel to change the
 * field of view. Replaces Cesium's own camera inputs. Returns a function that removes everything.
 */
export function attachCameraControls({ viewer, store, ground, sampleGround }: Target): () => void {
  const canvas = viewer.canvas
  viewer.scene.screenSpaceCameraController.enableInputs = false

  let dragging = false
  const onPointerDown = (e: PointerEvent) => {
    dragging = true
    canvas.setPointerCapture(e.pointerId)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    const pose = store.get()
    store.set({
      headingDeg: pose.headingDeg - e.movementX * LOOK_DEG_PER_PX,
      pitchDeg: pose.pitchDeg + e.movementY * LOOK_DEG_PER_PX,
    })
  }
  const onPointerUp = (e: PointerEvent) => {
    dragging = false
    canvas.releasePointerCapture(e.pointerId)
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    store.set({ fovDeg: store.get().fovDeg + e.deltaY * FOV_DEG_PER_WHEEL_UNIT })
  }

  const held = new Set<string>()
  const keyOf = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key)
  const onKeyDown = (e: KeyboardEvent) => {
    if (isFormField(e.target) || !(keyOf(e) in KEY_DIRECTIONS)) return
    e.preventDefault()
    held.add(keyOf(e))
  }
  const onKeyUp = (e: KeyboardEvent) => held.delete(keyOf(e))

  let frame = 0
  let last = performance.now()
  let lastSample = 0
  let sampling = false
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (held.size > 0) {
      let forward = 0
      let right = 0
      for (const key of held) {
        forward += KEY_DIRECTIONS[key].forward
        right += KEY_DIRECTIONS[key].right
      }
      const pose = store.get()
      store.set({
        position: walk(pose.position, pose.headingDeg, forward * WALK_SPEED_M_PER_S * dt, right * WALK_SPEED_M_PER_S * dt),
      })
      if (!sampling && now - lastSample > GROUND_SAMPLE_INTERVAL_MS) {
        sampling = true
        lastSample = now
        void sampleGround(store.get().position)
          .then((height) => {
            if (height === null) return
            ground.heightM = height
            store.set({}) // re-apply the pose with the new ground height
          })
          .finally(() => {
            sampling = false
          })
      }
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  return () => {
    cancelAnimationFrame(frame)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
}
