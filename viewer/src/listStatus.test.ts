import { describe, expect, it } from 'vitest'
import { infoErrorStatus, listStatus } from './listStatus'

describe('listStatus', () => {
  it('describes each state of the photo list', () => {
    expect(listStatus('loading')).toBe('Loading photos…')
    expect(listStatus([])).toBe('No photos found in this region.')
    expect(listStatus([{ pageId: 1, subject: { lon: 8, lat: 47 } }])).toBe('1 photo')
    expect(listStatus({ error: 'HTTP 429' })).toBe('Could not load photos: HTTP 429. Try again.')
  })
  it('reports photos whose file names could not be loaded', () => {
    expect(infoErrorStatus(1)).toBe('Could not load the file name of 1 photo. Try again.')
    expect(infoErrorStatus(12)).toBe('Could not load the file names of 12 photos. Try again.')
  })
  it('uses the plural for several photos', () => {
    const two = [
      { pageId: 1, subject: { lon: 8, lat: 47 } },
      { pageId: 2, subject: { lon: 8, lat: 47 } },
    ]
    expect(listStatus(two)).toBe('2 photos')
  })
})
