import { describe, expect, it } from 'vitest'
import { bearingDeg, formatResult, normalizeDegrees, offsetByMeters, resolveGroundHeight, walk } from './geo'

const camera = { lon: 8.5399621, lat: 47.3769854 }
const subject = { lon: 8.539965, lat: 47.377135 }

describe('geo', () => {
  it('wraps degrees into [0, 360)', () => {
    expect(normalizeDegrees(-1)).toBe(359)
    expect(normalizeDegrees(360)).toBe(0)
    expect(normalizeDegrees(725)).toBe(5)
  })
  it('computes the bearing from the Escher test camera to its subject', () => {
    expect(bearingDeg(camera, subject)).toBeCloseTo(0.75, 1)
  })
  it('offsets east and north by metres', () => {
    const p = offsetByMeters({ lon: 8.54, lat: 47.377 }, 100, 111.32)
    expect(p.lat).toBeCloseTo(47.378, 4)
    expect(p.lon).toBeCloseTo(8.5413264, 4)
  })
  it('walks relative to the heading', () => {
    const east = walk(camera, 90, 10, 0)
    expect(east.lon).toBeGreaterThan(camera.lon)
    expect(east.lat).toBeCloseTo(camera.lat, 6)
    const right = walk(camera, 0, 0, 10)
    expect(right.lon).toBeGreaterThan(camera.lon)
  })
  it('treats implausible ground heights as no data', () => {
    expect(resolveGroundHeight(407.8)).toBe(407.8)
    for (const bad of [undefined, null, NaN, 0, 9000]) expect(resolveGroundHeight(bad)).toBeNull()
  })
  it('formats the result', () => {
    const r = formatResult(camera, 359.6)
    expect(r.p1259).toBe('47.37699, 8.53996')
    expect(r.p7787).toBe('0')
    expect(formatResult(camera, -0.4).p7787).toBe('0')
  })
})
