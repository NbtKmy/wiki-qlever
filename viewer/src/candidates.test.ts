import { describe, expect, it } from 'vitest'
import { buildCandidatesQuery, parseCandidates } from './candidates'
import { REGIONS } from './config'

describe('candidates', () => {
  it('builds the query for a region', () => {
    const q = buildCandidatesQuery(REGIONS[0])
    expect(q).toContain('wdt:P9149')
    expect(q).toContain('FILTER NOT EXISTS { ?m wdt:P1259 ?x }')
    expect(q).toContain('Q685592')
    expect(q).toContain('8.66')
    expect(q).toContain('ORDER BY RAND()')
    expect(q).toContain(`LIMIT ${REGIONS[0].limit}`)
  })
  it('parses bindings into candidates and skips non-point values', () => {
    const json = {
      results: {
        bindings: [
          { m: { value: 'https://commons.wikimedia.org/entity/M19413018' }, c: { value: 'POINT(8.763100 47.504700)' } },
          { m: { value: 'https://commons.wikimedia.org/entity/M5' }, c: { value: 'POLYGON((1 2,3 4,5 6,1 2))' } },
        ],
      },
    }
    expect(parseCandidates(json)).toEqual([{ pageId: 19413018, subject: { lon: 8.7631, lat: 47.5047 } }])
    expect(parseCandidates({ results: { bindings: [] } })).toEqual([])
  })
})
