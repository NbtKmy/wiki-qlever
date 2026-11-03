import { describe, expect, it } from 'vitest'
import { trackGround } from './groundTracker'
import type { LonLat } from './geo'
import { createPoseStore, type CameraPose } from './poseStore'

const initial: CameraPose = {
  position: { lon: 8.54, lat: 47.377 },
  heightAboveGroundM: 1.6,
  headingDeg: 0,
  pitchDeg: 0,
  fovDeg: 60,
}
const A = { lon: 8.541, lat: 47.377 }
const B = { lon: 8.542, lat: 47.377 }
const C = { lon: 8.543, lat: 47.377 }

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('trackGround', () => {
  it('samples the ground when the position changes, then re-applies the pose', async () => {
    const store = createPoseStore(initial)
    const ground = { heightM: 400 }
    const calls: LonLat[] = []
    let applied = 0
    store.subscribe(() => applied++)
    trackGround(store, ground, async (p) => {
      calls.push(p)
      return 410
    })
    store.set({ position: A })
    await flush()
    expect(calls).toEqual([A])
    expect(ground.heightM).toBe(410)
    expect(applied).toBe(2) // the move, then the re-apply with the new ground height
  })

  it('does not sample when only the direction changes', async () => {
    const store = createPoseStore(initial)
    const calls: LonLat[] = []
    trackGround(store, { heightM: 400 }, async (p) => {
      calls.push(p)
      return 410
    })
    store.set({ headingDeg: 90, fovDeg: 40, heightAboveGroundM: 5 })
    await flush()
    expect(calls).toEqual([])
  })

  it('samples once more, at the latest position, after moves made during a request', async () => {
    const store = createPoseStore(initial)
    const ground = { heightM: 400 }
    const pending = [deferred<number | null>(), deferred<number | null>()]
    const calls: LonLat[] = []
    let i = 0
    trackGround(store, ground, (p) => {
      calls.push(p)
      return pending[i++].promise
    })
    store.set({ position: A })
    store.set({ position: B })
    store.set({ position: C })
    expect(calls).toEqual([A])
    pending[0].resolve(410)
    await flush()
    expect(calls).toEqual([A, C])
    pending[1].resolve(420)
    await flush()
    expect(ground.heightM).toBe(420)
  })

  it('keeps the previous ground height when there is no terrain data', async () => {
    const store = createPoseStore(initial)
    const ground = { heightM: 400 }
    trackGround(store, ground, async () => null)
    store.set({ position: A })
    await flush()
    expect(ground.heightM).toBe(400)
  })

  it('stops sampling after it is detached', async () => {
    const store = createPoseStore(initial)
    const calls: LonLat[] = []
    const stop = trackGround(store, { heightM: 400 }, async (p) => {
      calls.push(p)
      return 410
    })
    stop()
    store.set({ position: A })
    await flush()
    expect(calls).toEqual([])
  })
})
