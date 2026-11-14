import { describe, expect, it } from 'vitest'
import { createDecisionStore, summarize, toQuickStatements, toReviewLog, type AcceptedValue } from './decisions'
import {
  buildCategoryUrl,
  buildCollectionGapQuery,
  buildPageIdGapQuery,
  buildPrefixGapQuery,
  parseCategoryMembers,
  parseGapFiles,
  titleFromFilePath,
} from './gaps'
import { afterEach, vi } from 'vitest'
import { bindingsOf, describeStatus, parseFirstJson, retryAfterMs, retryPolicy, sparql } from './qlever'

describe('qlever', () => {
  it('parses only the first JSON document when the body repeats', () => {
    const doc = '{"results":{"bindings":[{"m":{"value":"a } \\" b"}}]}}'
    expect(bindingsOf(parseFirstJson(doc + doc))).toHaveLength(1)
    expect(bindingsOf(parseFirstJson(doc))).toHaveLength(1)
    expect(() => parseFirstJson('<html>504</html>')).toThrow()
  })
  describe('HTTP 429', () => {
    afterEach(() => vi.unstubAllGlobals())
    const answer = (status: number, body = '{"results":{"bindings":[{"x":{"value":"1"}}]}}') =>
      new Response(body, { status, headers: status === 429 ? { 'Retry-After': '0' } : {} })

    it('waits and tries again, then returns the answer', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(answer(429)).mockResolvedValueOnce(answer(429)).mockResolvedValueOnce(answer(200))
      vi.stubGlobal('fetch', fetchMock)
      expect(await sparql('https://example.org/sparql', 'SELECT * {}')).toEqual([{ x: { value: '1' } }])
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    it('gives up after the last delay', async () => {
      const saved = retryPolicy.delaysMs
      retryPolicy.delaysMs = [0]
      const fetchMock = vi.fn().mockImplementation(async () => answer(429))
      vi.stubGlobal('fetch', fetchMock)
      await expect(sparql('https://example.org/sparql', 'SELECT * {}')).rejects.toThrow(/still rate limiting/)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      retryPolicy.delaysMs = saved
    })
    it('retries a gateway error (HTTP 502) too', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(answer(502)).mockResolvedValueOnce(answer(200))
      vi.stubGlobal('fetch', fetchMock)
      const saved = retryPolicy.delaysMs
      retryPolicy.delaysMs = [0]
      expect(await sparql('https://example.org/sparql', 'SELECT * {}')).toHaveLength(1)
      retryPolicy.delaysMs = saved
    })
    it('does not retry other errors', async () => {
      const fetchMock = vi.fn().mockResolvedValue(answer(504))
      vi.stubGlobal('fetch', fetchMock)
      await expect(sparql('https://example.org/sparql', 'SELECT * {}')).rejects.toThrow(/smaller batch/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    it('reads Retry-After in seconds and caps it', () => {
      expect(retryAfterMs('5')).toBe(5000)
      expect(retryAfterMs('600')).toBe(60000)
      expect(retryAfterMs(null)).toBeNull()
      expect(retryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT')).toBeNull()
    })
  })

  it('explains the two errors the docs warn about', () => {
    expect(describeStatus(429)).toMatch(/still rate limiting/)
    expect(describeStatus(504)).toMatch(/smaller batch/)
    expect(describeStatus(500)).toBe('HTTP 500')
  })
})

describe('gaps', () => {
  it('builds the collection query with paging', () => {
    const q = buildCollectionGapQuery('Q190260', 20, 40)
    expect(q).toContain('?m wdt:P195 wd:Q190260 .')
    expect(q).toContain('FILTER NOT EXISTS { ?m wdt:P180 ?d }')
    expect(q).toContain('LIMIT 20 OFFSET 40')
  })
  it('refuses anything that is not an item ID', () => {
    expect(() => buildCollectionGapQuery('Q1 } ?s ?p ?o {', 20, 0)).toThrow(/not a Wikidata item ID/)
  })
  it('builds the file-name query the way docs/collections.md does, with a LIMIT', () => {
    const q = buildPrefixGapQuery('ETH Bildarchiv', 10, 0)
    expect(q).toContain('STRSTARTS(STR(?u), "http://commons.wikimedia.org/wiki/Special:FilePath/ETH%20Bildarchiv")')
    expect(q).toContain('LIMIT 10 OFFSET 0')
    expect(q).not.toContain('ORDER BY')
    expect(buildPrefixGapQuery('a"b', 1, 0)).not.toContain('a"b')
  })
  it('builds the page-ID query', () => {
    expect(buildPageIdGapQuery([5, 7])).toContain(
      'VALUES ?m { <https://commons.wikimedia.org/entity/M5> <https://commons.wikimedia.org/entity/M7> }',
    )
  })
  it('turns a Special:FilePath URL back into a file name', () => {
    expect(
      titleFromFilePath(
        'http://commons.wikimedia.org/wiki/Special:FilePath/Zentralbibliothek%20Z%C3%BCrich%20-%20Escherdenkmal%20-%20991028231679705501.jpg',
      ),
    ).toBe('Zentralbibliothek Zürich - Escherdenkmal - 991028231679705501.jpg')
    expect(titleFromFilePath('http://example.org/x.jpg')).toBeNull()
  })
  it('parses gap rows and drops duplicates', () => {
    const m = { value: 'https://commons.wikimedia.org/entity/M155155057' }
    const u = { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/A_b.jpg' }
    expect(parseGapFiles([{ m, u }, { m, u }, { m: { value: 'x' }, u }])).toEqual([{ pageId: 155155057, title: 'A b.jpg' }])
  })
  it('lists category files through the Commons API', () => {
    const url = new URL(buildCategoryUrl('Media contributed by the ETH-Bibliothek', 50, 'file|ABC'))
    expect(url.searchParams.get('cmtitle')).toBe('Category:Media contributed by the ETH-Bibliothek')
    expect(url.searchParams.get('cmtype')).toBe('file')
    expect(url.searchParams.get('origin')).toBe('*')
    expect(url.searchParams.get('cmcontinue')).toBe('file|ABC')
    expect(
      parseCategoryMembers({ continue: { cmcontinue: 'next' }, query: { categorymembers: [{ pageid: 1 }, {}, { pageid: 2 }] } }),
    ).toEqual({ pageIds: [1, 2], next: 'next' })
    expect(parseCategoryMembers({})).toEqual({ pageIds: [], next: null })
  })
})

describe('decisions', () => {
  const file = { pageId: 155155057, title: 'Zentralbibliothek Zürich - Escherdenkmal - 991028231679705501.jpg' }
  const value = (qid: string): AcceptedValue => ({
    qid,
    label: qid,
    term: 'Escherdenkmal',
    source: 'file name',
    score: 5,
    reasons: [],
  })
  const memory = () => {
    const data = new Map<string, string>()
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
  }
  const fixedNow = () => new Date('2026-11-13T09:00:00Z')

  it('exports one QuickStatements line per accepted value, with M IDs', () => {
    const store = createDecisionStore(null, fixedNow)
    store.accept(file, null, value('Q111'))
    store.accept(file, null, value('Q111'))
    store.accept(file, null, value('Q222'))
    store.setRejected({ pageId: 9, title: 'Other.jpg' }, null, true)
    expect(toQuickStatements(store.all())).toBe('M155155057|P180|Q111\nM155155057|P180|Q222')
    expect(summarize(store.all())).toEqual({ files: 1, statements: 2, rejected: 1 })
  })
  it('forgets a file once nothing is accepted and it is not rejected', () => {
    const store = createDecisionStore(null, fixedNow)
    store.accept(file, null, value('Q111'))
    store.withdraw(file.pageId, 'Q111')
    expect(store.all()).toEqual([])
    store.setRejected(file, null, true)
    store.setRejected(file, null, false)
    expect(store.all()).toEqual([])
  })
  it('clears accepted values when the reviewer says nothing fits', () => {
    const store = createDecisionStore(null, fixedNow)
    store.accept(file, null, value('Q111'))
    store.setRejected(file, null, true)
    expect(store.get(file.pageId)).toMatchObject({ rejected: true, accepted: [] })
    expect(toQuickStatements(store.all())).toBe('')
  })
  it('survives a reload through storage and tolerates broken storage', () => {
    const storage = memory()
    createDecisionStore(storage, fixedNow).accept(file, null, value('Q111'))
    expect(createDecisionStore(storage).get(file.pageId)?.accepted[0].qid).toBe('Q111')
    storage.setItem('wiki-qlever.depicts-review.v1', '{not json')
    expect(createDecisionStore(storage).all()).toEqual([])
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const store = createDecisionStore(broken, fixedNow)
    store.accept(file, null, value('Q111'))
    expect(store.all()).toHaveLength(1)
  })
  it('keeps the source and the heading hint in the review log', () => {
    const store = createDecisionStore(null, fixedNow)
    const heading = { phrase: 'gegen Süd', headingDeg: 180, reading: 'looking towards' as const }
    store.accept(file, heading, value('Q111'))
    const log = JSON.parse(toReviewLog(store.all(), 'collection (P195) = Q190260'))
    expect(log.collection).toBe('collection (P195) = Q190260')
    expect(log.decisions[0]).toMatchObject({
      pageId: 155155057,
      heading: { headingDeg: 180 },
      decidedAt: '2026-11-13T09:00:00.000Z',
      accepted: [{ qid: 'Q111', source: 'file name' }],
    })
  })
  it('tells subscribers about every change', () => {
    const store = createDecisionStore(null, fixedNow)
    let calls = 0
    const stop = store.subscribe(() => calls++)
    store.accept(file, null, value('Q111'))
    store.clear()
    stop()
    store.accept(file, null, value('Q111'))
    expect(calls).toBe(2)
  })
})

describe('live check before export', async () => {
  const { buildCheckUrl, parseCheck, describeCheck } = await import('./verify')
  const { createDecisionStore, toQuickStatements } = await import('./decisions')
  it('asks Wikidata for the items with redirects resolved', () => {
    const p = new URL(buildCheckUrl(['Q1', 'Q2'])).searchParams
    expect(p.get('ids')).toBe('Q1|Q2')
    expect(p.get('redirects')).toBe('yes')
    expect(p.get('origin')).toBe('*')
  })
  it('reads merged and deleted items', () => {
    const check = parseCheck({
      entities: {
        Q42: { id: 'Q42' },
        Q999999999: { id: 'Q999999999', missing: '' },
        Q5: { id: 'Q5', redirects: { from: 'Q123', to: 'Q5' } },
      },
    })
    expect([...check.redirects]).toEqual([['Q123', 'Q5']])
    expect([...check.missing]).toEqual(['Q999999999'])
    expect(describeCheck(check)).toBe('Q123 → Q5 merged on Wikidata: the target is exported. Q999999999 deleted on Wikidata: left out')
    expect(describeCheck(parseCheck({ entities: {} }))).toBe('')
  })
  it('exports the target of a redirect, drops deleted items and repeats nothing', () => {
    const store = createDecisionStore(null)
    const value = (qid: string) => ({ qid, label: qid, term: 't', source: 's', score: 1, reasons: [] })
    store.accept({ pageId: 1, title: 'a' }, null, value('Q123'))
    store.accept({ pageId: 1, title: 'a' }, null, value('Q5'))
    store.accept({ pageId: 1, title: 'a' }, null, value('Q999999999'))
    const check = { redirects: new Map([['Q123', 'Q5']]), missing: new Set(['Q999999999']) }
    expect(toQuickStatements(store.all(), check)).toBe('M1|P180|Q5')
    expect(toQuickStatements(store.all())).toBe('M1|P180|Q123\nM1|P180|Q5\nM1|P180|Q999999999')
  })
})

describe('rejections in the store', async () => {
  const { createDecisionStore } = await import('./decisions')
  const file = { pageId: 5, title: 'x.jpg' }
  it('remembers a rejection per term, unticks the item, and survives without accepted values', () => {
    const store = createDecisionStore(null)
    store.accept(file, null, { qid: 'Q1', label: 'Q1', term: 't', source: 's', score: 1, reasons: [] })
    store.rejectItem(file, null, 'Q1', 'Schloss Neuenburg')
    expect(store.get(5)?.accepted).toEqual([])
    expect([...store.rejectionsByTerm()]).toEqual([['schloss neuenburg', new Set(['Q1'])]])
    store.rejectItem(file, null, 'Q1', 'Schloss Neuenburg')
    expect(store.get(5)?.rejectedItems).toHaveLength(1)
    store.unrejectItem(5, 'Q1', 'Schloss Neuenburg')
    expect(store.get(5)).toBeUndefined()
  })
}
)
