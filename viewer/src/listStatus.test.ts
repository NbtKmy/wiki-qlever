import { describe, expect, it } from 'vitest'
import { listStatus } from './listStatus'

describe('listStatus', () => {
  it('describes each state of the photo list', () => {
    expect(listStatus('loading')).toBe('Loading photos…')
    expect(listStatus([])).toBe('No photos found in this region.')
    expect(listStatus([{ pageId: 1, subject: { lon: 8, lat: 47 } }])).toBe('1 photo')
    expect(listStatus({ error: 'HTTP 429' })).toBe('Could not load photos: HTTP 429. Try again.')
  })
  it('uses the plural for several photos', () => {
    const two = [
      { pageId: 1, subject: { lon: 8, lat: 47 } },
      { pageId: 2, subject: { lon: 8, lat: 47 } },
    ]
    expect(listStatus(two)).toBe('2 photos')
  })
})
