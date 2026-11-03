import { normalizeDegrees, type LonLat } from './geo'

export type CameraPose = {
  position: LonLat
  heightAboveGroundM: number
  headingDeg: number
  pitchDeg: number
  fovDeg: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function sanitize(pose: CameraPose): CameraPose {
  return {
    ...pose,
    headingDeg: normalizeDegrees(pose.headingDeg),
    pitchDeg: clamp(pose.pitchDeg, -89, 89),
    fovDeg: clamp(pose.fovDeg, 10, 120),
  }
}

export function createPoseStore(initial: CameraPose) {
  const start = sanitize(initial)
  let pose = start
  const subscribers = new Set<(pose: CameraPose) => void>()

  const notify = () => subscribers.forEach((fn) => fn(pose))

  return {
    get: (): CameraPose => pose,
    set(patch: Partial<CameraPose>) {
      pose = sanitize({ ...pose, ...patch })
      notify()
    },
    reset() {
      pose = start
      notify()
    },
    isDirty: (): boolean => JSON.stringify(pose) !== JSON.stringify(start),
    subscribe(fn: (pose: CameraPose) => void): () => void {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
  }
}

export type PoseStore = ReturnType<typeof createPoseStore>
