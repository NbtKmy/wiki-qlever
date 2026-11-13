import { describe, expect, it } from 'vitest'
import { buildMemory, recall } from './memory'
import {
  buildAnnotatedQuery,
  buildClassQuery,
  byKind,
  evaluate,
  kindOf,
  parseAnnotated,
  parseClasses,
  sample,
  summarize,
  summarizeSources,
  type AnnotatedFile,
} from './benchmark'
import { leaveOneOut } from './benchRunner'
import { CONSENSUS_TITLE, type Group } from './wikidata'

const WD = 'http://www.wikidata.org/entity/'
const url = (title: string) => ({ value: `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}` })
const zb = (subject: string, n: string) => `Zentralbibliothek Zürich - ${subject} - 99100000${n}5501.jpg`

const group = (title: string, source: string, qids: string[]): Group => ({
  title,
  source,
  candidates: qids.map((qid) => ({ qid, label: qid, description: null, typeLabels: [], score: 1, origin: '', reasons: [] })),
})
const file = (gold: string[]): AnnotatedFile => ({ pageId: 1, title: zb('Sihl', '0001'), gold: new Set(gold) })

describe('annotated files', () => {
  it('asks for every depicts statement with its file', () => {
    expect(buildAnnotatedQuery('Q190260')).toContain('SELECT ?m ?u ?d WHERE')
    expect(() => buildAnnotatedQuery('x')).toThrow()
  })
  it('groups the statements by file and keeps the rows for the memory', () => {
    const { files, rows } = parseAnnotated([
      { m: { value: 'https://commons.wikimedia.org/entity/M7' }, u: url(zb('Sihl', '0001')), d: { value: WD + 'Q660909' } },
      { m: { value: 'https://commons.wikimedia.org/entity/M7' }, u: url(zb('Sihl', '0001')), d: { value: WD + 'Q648218' } },
      { m: { value: 'https://commons.wikimedia.org/entity/M8' }, u: url(zb('Enge', '0002')), d: { value: WD + 'Q648218' } },
      { m: { value: 'x' }, u: url('a'), d: { value: WD + 'Q1' } },
    ])
    expect(files.map((f) => [f.pageId, [...f.gold]])).toEqual([
      [7, ['Q660909', 'Q648218']],
      [8, ['Q648218']],
    ])
    expect(rows).toHaveLength(3)
  })
})

describe('sample', () => {
  const items = Array.from({ length: 100 }, (_, i) => i)
  it('is the same for the same seed and different for another', () => {
    expect(sample(items, 10, 42)).toEqual(sample(items, 10, 42))
    expect(sample(items, 10, 42)).not.toEqual(sample(items, 10, 43))
  })
  it('draws without repeats and leaves the input alone', () => {
    const s = sample(items, 100, 1)
    expect(new Set(s).size).toBe(100)
    expect(items[0]).toBe(0)
    expect(sample(items, 500, 1)).toHaveLength(100)
  })
})

describe('kind of photograph', () => {
  it('asks for the classes through subclass paths', () => {
    expect(buildClassQuery(['Q16525'])).toContain('?i wdt:P31/wdt:P279* ?class .')
  })
  it('lets people win over buildings, and falls back to other', () => {
    const classes = parseClasses([
      { i: { value: WD + 'Q1' }, class: { value: WD + 'Q5' } },
      { i: { value: WD + 'Q2' }, class: { value: WD + 'Q811979' } },
      { i: { value: WD + 'Q3' }, class: { value: WD + 'Q271669' } },
    ])
    expect(kindOf(new Set(['Q2', 'Q1']), classes)).toBe('people')
    expect(kindOf(new Set(['Q2', 'Q3']), classes)).toBe('buildings')
    expect(kindOf(new Set(['Q3']), classes)).toBe('nature')
    expect(kindOf(new Set(['Q9']), classes)).toBe('other')
  })
})

describe('evaluate', () => {
  it('reads top-1, top-3, recall and the sources in card order', () => {
    const groups = [
      group(CONSENSUS_TITLE, 'the same item from independent sources', ['Q660909']),
      group('“Papiermühle”', 'file name', ['Q99', 'Q660909']),
      group('Same collection', 'what other files of this collection depict', ['Q648218', 'Q77']),
    ]
    const r = evaluate(file(['Q660909', 'Q648218', 'Q5000']), 'nature', groups)
    expect(r.shown).toEqual(['Q660909', 'Q99', 'Q648218', 'Q77'])
    expect(r).toMatchObject({ top1: true, top3: true, found: true })
    expect(r.recall).toBeCloseTo(2 / 3)
    expect(r.sources).toEqual({
      agreement: { shown: true, hit: true, firstHit: true },
      'file name': { shown: true, hit: true, firstHit: false },
      'earlier decisions': { shown: true, hit: true, firstHit: true },
    })
  })
  it('counts an empty card as abstaining', () => {
    const r = evaluate(file(['Q1']), 'other', [group('“X”', 'file name', [])])
    expect(r).toMatchObject({ shown: [], top1: false, top3: false, found: false, sources: {} })
  })
})

describe('summaries', () => {
  const results = [
    evaluate(file(['Q1']), 'nature', [group('“A”', 'file name', ['Q1'])]),
    evaluate(file(['Q2']), 'nature', [group('“A”', 'file name', ['Q9', 'Q8', 'Q2'])]),
    evaluate(file(['Q3']), 'people', []),
    { ...evaluate(file(['Q4']), 'people', []), error: 'HTTP 429' },
  ]
  it('gives percentages without the failed files', () => {
    expect(summarize(results)).toEqual({ files: 3, errors: 1, top1: 33.3, top3: 66.7, found: 66.7, recall: 66.7, abstained: 33.3, meanShown: 1.3 })
  })
  it('splits by kind', () => {
    const k = byKind(results)
    expect(Object.keys(k)).toEqual(['all', 'people', 'nature'])
    expect(k.nature.top1).toBe(50)
  })
  it('measures each source only where it showed something', () => {
    expect(summarizeSources(results)).toEqual([{ source: 'file name', files: 2, coverage: 66.7, hitWhenShown: 100, firstCorrect: 50 }])
  })
})

describe('leave one out', () => {
  it('does not let the memory recall the file under test', () => {
    const rows = [
      { pageId: 1, title: zb('Waldhüsli Degenried', '0001'), qid: 'Q1' },
      { pageId: 2, title: zb('Sihl bei Hochwasser', '0002'), qid: 'Q660909' },
      { pageId: 3, title: zb('Sihl im Winter', '0003'), qid: 'Q660909' },
    ]
    const all = buildMemory(rows.map((r) => [r.title, r.qid]))
    expect(recall(all, zb('Waldhüsli Degenried', '0001')).map((h) => h.qid)).toEqual(['Q1'])
    expect(recall(leaveOneOut(rows, 1), zb('Waldhüsli Degenried', '0001'))).toEqual([])
    expect(recall(leaveOneOut(rows, 2), zb('Sihl bei Hochwasser', '0002'))).toEqual([])
  })
})
