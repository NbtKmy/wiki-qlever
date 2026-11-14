import { describe, expect, it } from 'vitest'
import { seriesKey, seriesOffers } from './series'

describe('series', () => {
  it('gives files with the same caption and another number the same key', () => {
    const a = seriesKey('CH-NB - Persien, Isfahan- Menschen - Annemarie Schwarzenbach - SLA-Schwarzenbach-A-5-07-177.jpg')
    const b = seriesKey('CH-NB - Persien, Isfahan- Menschen - Annemarie Schwarzenbach - SLA-Schwarzenbach-A-5-07-178.jpg')
    expect(a).toBe('persien isfahan menschen')
    expect(b).toBe(a)
    expect(seriesKey('CH-NB - Persien, Täbris- Menschen - Annemarie Schwarzenbach - SLA-Schwarzenbach-A-5-07-179.jpg')).not.toBe(a)
  })
  it('gives no key when nothing but numbers is left', () => {
    expect(seriesKey('CH-NB - Collection Gugelmann - GS-GUGE-100-11.tif')).toBe('')
  })
  it('offers what was accepted on the other files of the series, once each', () => {
    const files = [
      { pageId: 1, title: 'A 1', key: 'k' },
      { pageId: 2, title: 'A 2', key: 'k' },
      { pageId: 3, title: 'A 3', key: 'k' },
      { pageId: 4, title: 'B', key: 'other' },
    ]
    const accepted: Record<number, { qid: string; label: string }[]> = {
      2: [{ qid: 'Q1', label: 'Isfahan' }],
      3: [
        { qid: 'Q1', label: 'Isfahan' },
        { qid: 'Q2', label: 'human' },
      ],
      4: [{ qid: 'Q9', label: 'elsewhere' }],
    }
    const result = seriesOffers(1, 'k', files, (id) => accepted[id] ?? [])
    expect(result.siblings).toBe(2)
    expect(result.offers).toEqual([
      { qid: 'Q1', label: 'Isfahan', from: 'A 2' },
      { qid: 'Q2', label: 'human', from: 'A 3' },
    ])
    expect(seriesOffers(1, '', files, (id) => accepted[id] ?? []).siblings).toBe(0)
  })
})
