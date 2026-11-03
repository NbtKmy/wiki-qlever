export type LonLat = { lon: number; lat: number }

const METERS_PER_DEGREE_LAT = 111_320
const toRadians = (deg: number) => (deg * Math.PI) / 180
const toDegrees = (rad: number) => (rad * 180) / Math.PI

// Valid heights above the ellipsoid in Switzerland are about 240–4700 m; anything outside is "no data".
const MIN_GROUND_HEIGHT_M = 150
const MAX_GROUND_HEIGHT_M = 4800

export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Initial compass bearing from one point to another, in degrees clockwise from north. */
export function bearingDeg(from: LonLat, to: LonLat): number {
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)
  const dLon = toRadians(to.lon - from.lon)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return normalizeDegrees(toDegrees(Math.atan2(y, x)))
}

/** Flat-earth offset; accurate enough for distances of a few hundred metres. */
export function offsetByMeters(origin: LonLat, eastM: number, northM: number): LonLat {
  return {
    lat: origin.lat + northM / METERS_PER_DEGREE_LAT,
    lon: origin.lon + eastM / (METERS_PER_DEGREE_LAT * Math.cos(toRadians(origin.lat))),
  }
}

/** Move forward and to the right relative to a compass heading. */
export function walk(origin: LonLat, headingDeg: number, forwardM: number, rightM: number): LonLat {
  const h = toRadians(headingDeg)
  const east = forwardM * Math.sin(h) + rightM * Math.cos(h)
  const north = forwardM * Math.cos(h) - rightM * Math.sin(h)
  return offsetByMeters(origin, east, north)
}

export function resolveGroundHeight(sampled: number | undefined | null): number | null {
  if (typeof sampled !== 'number' || !Number.isFinite(sampled)) return null
  return sampled >= MIN_GROUND_HEIGHT_M && sampled <= MAX_GROUND_HEIGHT_M ? sampled : null
}

export function formatResult(
  position: LonLat,
  headingDeg: number,
): { p1259: string; p7787: string; text: string } {
  const p1259 = `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`
  const p7787 = String(normalizeDegrees(Math.round(headingDeg)))
  return { p1259, p7787, text: `P1259: ${p1259}\nP7787: ${p7787} (circa)` }
}
