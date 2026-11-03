import type { LonLat } from './geo'
import type { PoseStore } from './poseStore'

const samePosition = (a: LonLat, b: LonLat) => a.lon === b.lon && a.lat === b.lat

/**
 * Keeps `ground.heightM` in step with the camera position, however the camera was moved (keys, mouse
 * or sliders). One request runs at a time; moves made meanwhile trigger one more request at the latest
 * position. When the ground height changes the pose is re-applied. Returns a function that detaches it.
 */
export function trackGround(
  store: PoseStore,
  ground: { heightM: number },
  sampleGround: (position: LonLat) => Promise<number | null>,
): () => void {
  let requested = store.get().position
  let inFlight = false

  const run = async () => {
    inFlight = true
    const target = store.get().position
    requested = target
    try {
      const height = await sampleGround(target)
      if (height !== null) {
        ground.heightM = height
        store.set({}) // re-apply the pose with the new ground height
      }
    } catch {
      // keep the previous ground height; the next move tries again
    } finally {
      inFlight = false
    }
    if (!samePosition(store.get().position, requested)) void run()
  }

  return store.subscribe((pose) => {
    if (!inFlight && !samePosition(pose.position, requested)) void run()
  })
}
