import { describe, expect, it } from 'vitest'
import { createPoseStore, type CameraPose } from './poseStore'

const initial: CameraPose = {
  position: { lon: 8.54, lat: 47.377 },
  heightAboveGroundM: 1.6,
  headingDeg: 0,
  pitchDeg: 0,
  fovDeg: 60,
}

describe('poseStore', () => {
  it('wraps the heading and clamps pitch and field of view', () => {
    const store = createPoseStore(initial)
    store.set({ headingDeg: -1 })
    expect(store.get().headingDeg).toBe(359)
    store.set({ pitchDeg: 120 })
    expect(store.get().pitchDeg).toBe(89)
    store.set({ fovDeg: 500 })
    expect(store.get().fovDeg).toBe(120)
    store.set({ fovDeg: 1 })
    expect(store.get().fovDeg).toBe(10)
  })
  it('tracks whether the pose differs from the start', () => {
    const store = createPoseStore(initial)
    expect(store.isDirty()).toBe(false)
    store.set({ headingDeg: 10 })
    expect(store.isDirty()).toBe(true)
    store.reset()
    expect(store.isDirty()).toBe(false)
    expect(store.get()).toEqual(initial)
  })
  it('calls subscribers once per change until they unsubscribe', () => {
    const store = createPoseStore(initial)
    const seen: number[] = []
    const unsubscribe = store.subscribe((pose) => seen.push(pose.headingDeg))
    store.set({ headingDeg: 5 })
    store.set({ headingDeg: 6 })
    unsubscribe()
    store.set({ headingDeg: 7 })
    expect(seen).toEqual([5, 6])
  })
})
