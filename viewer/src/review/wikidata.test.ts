import { describe, expect, it } from 'vitest'
import type { Binding } from './qlever'
import type { Hit } from './search'
import type { SearchTerm } from './titleParse'
import {
  applyTypeLabels,
  buildDetailsQuery,
  buildTypeLabelQuery,
  arrangeGroups,
  categoryGroup,
  consensusGroup,
  containsWords,
  CONSENSUS_TITLE,
  type Group,
  parseDetails,
  parseTypeLabels,
  rankTerm,
} from './wikidata'

const WD = 'http://www.wikidata.org/entity/'

type Extra = { type?: string; country?: string; coord?: boolean; born?: string; died?: string; desc?: string; en?: string }

// One row in the shape qlever.dev returns for buildDetailsQuery.
function row(qid: string, de: string | null, links: number, extra: Extra = {}): Binding {
  return {
    item: { value: WD + qid },
    links: { value: String(links) },
    ...(de ? { de: { value: de } } : {}),
    ...(extra.en ? { en: { value: extra.en } } : {}),
    ...(extra.desc ? { desc: { value: extra.desc } } : {}),
    ...(extra.type ? { type: { value: WD + extra.type } } : {}),
    ...(extra.country ? { country: { value: WD + extra.country } } : {}),
    ...(extra.coord ? { coord: { value: 'POINT(8 47)' } } : {}),
    ...(extra.born ? { born: { value: extra.born } } : {}),
    ...(extra.died ? { died: { value: extra.died } } : {}),
  }
}

const place = (text: string, more: Partial<SearchTerm> = {}): SearchTerm => ({ text, kind: 'place', source: 'file name', ...more })
const byLabel = (...qids: string[]): Hit[] => qids.map((qid, rank) => ({ qid, via: 'label', rank }))
const byText = (...qids: string[]): Hit[] => qids.map((qid, rank) => ({ qid, via: 'fulltext', rank }))
const order = (term: SearchTerm, hits: Hit[], rows: Binding[], country: string | null = 'Q39') =>
  rankTerm(term, hits, parseDetails(rows), country).candidates.map((c) => c.qid)

describe('queries', () => {
  it('asks for the properties of all candidates of a file in one query, without type labels', () => {
    const q = buildDetailsQuery(['Q16525', 'Q733786'])
    expect(q).toContain('VALUES ?item { wd:Q16525 wd:Q733786 }')
    expect(q).toContain('wikibase:sitelinks')
    expect(q).toContain('?item wdt:P625 ?coord')
    expect(q).not.toContain('typeLabel')
    expect(q).not.toContain('SERVICE')
  })
  it('asks for the labels of the types in a second small query', () => {
    const q = buildTypeLabelQuery(['Q8502', 'Q70208'])
    expect(q).toContain('VALUES ?type { wd:Q8502 wd:Q70208 }')
    expect(q).toContain('FILTER(LANG(?typeLabel) = "en")')
  })
})

describe('parseDetails', () => {
  it('merges the rows of one item and prefers the German label', () => {
    const items = parseDetails([
      row('Q16525', 'Mönch', 48, { type: 'Q8502', country: 'Q39', coord: true, desc: 'mountain in the Bernese Alps', en: 'Mönch' }),
      row('Q16525', 'Mönch', 48, { type: 'Q207326', country: 'Q39', coord: true }),
      { item: { value: 'http://www.wikidata.org/entity/P31' } },
    ])
    expect(items.size).toBe(1)
    expect(items.get('Q16525')).toMatchObject({ label: 'Mönch', sitelinks: 48, located: true, description: 'mountain in the Bernese Alps' })
    expect([...items.get('Q16525')!.types.keys()]).toEqual(['Q8502', 'Q207326'])
  })
  it('falls back to the English label and reads the year of a date', () => {
    const items = parseDetails([row('Q7569', null, 150, { en: 'child', born: '1855-12-19T00:00:00Z', died: '1939-02-07T00:00:00Z' })])
    expect(items.get('Q7569')).toMatchObject({ label: 'child', born: 1855, died: 1939 })
  })
  it('fills type labels in and leaves the ID where none is known', () => {
    const items = parseDetails([row('Q16525', 'Mönch', 48, { type: 'Q8502' }), row('Q16525', 'Mönch', 48, { type: 'Q999' })])
    applyTypeLabels(items.values(), parseTypeLabels([{ type: { value: WD + 'Q8502' }, typeLabel: { value: 'mountain' } }]))
    expect([...items.get('Q16525')!.types.values()]).toEqual(['mountain', 'Q999'])
  })
})

// Search hits and item values as returned by wikidata.org and qlever.dev on 12 November 2026.
// The sitelink counts of Q16823309 and Q7569 were not read and are set by hand.
describe('ranking on live data', () => {
  it('Birnbaum: the pear tree beats the family name and the Czech village', () => {
    const rows = [
      row('Q16823309', 'Birnbaum', 2, { type: 'Q101352' }),
      row('Q1022315', 'Hrušky', 25, { country: 'Q213', coord: true }),
      row('Q146281', 'Kultur-Birne', 80),
    ]
    const group = rankTerm(place('Birnbaum'), byLabel('Q16823309', 'Q1022315', 'Q146281'), parseDetails(rows), 'Q39')
    expect(group.candidates.map((c) => c.qid)).toEqual(['Q146281', 'Q1022315', 'Q16823309'])
    expect(group.candidates[1].reasons).toContain('country is not Q39')
    expect(group.candidates[2].reasons).toContain('type is rarely what a photo shows')
  })
  it('Turnerdenkmal: the Zürich monument from the full-text search beats three German namesakes', () => {
    const rows = [
      row('Q104872898', 'Turnerdenkmal (Ruhland, Ehrenhain)', 1, { country: 'Q183', coord: true }),
      row('Q104872648', 'Turnerdenkmal (Ruhland, Ortrander Straße)', 1, { country: 'Q183', coord: true }),
      row('Q116746168', 'Turnerdenkmal', 1, { country: 'Q183', coord: true }),
      row('Q135273272', 'Turnerdenkmal (Zürich)', 1, { country: 'Q39', coord: true }),
    ]
    const hits = [...byLabel('Q104872898', 'Q104872648', 'Q116746168'), ...byText('Q135273272')]
    const group = rankTerm(place('Turnerdenkmal'), hits, parseDetails(rows), 'Q39')
    expect(group.candidates[0]).toMatchObject({ qid: 'Q135273272', label: 'Turnerdenkmal (Zürich)' })
    expect(group.candidates[0].reasons).toEqual(
      expect.arrayContaining(['full-text search in Q39, hit 1', 'has coordinates', 'country is Q39']),
    )
    expect(order(place('Turnerdenkmal'), hits, rows, null)[0]).not.toBe('Q135273272')
  })
  it('Kinder: "child" is found through its alias and ranks first', () => {
    const rows = [row('Q7569', 'Kind', 150), row('Q126807', 'Kindergarten', 98), row('Q19902561', 'Kinder', 3, { type: 'Q101352' })]
    expect(order(place('Kinder'), byLabel('Q7569', 'Q126807', 'Q19902561'), rows)).toEqual(['Q7569', 'Q126807', 'Q19902561'])
  })
  it('Mönch: the mountain (48 sitelinks) beats the religious role (97)', () => {
    const rows = [row('Q733786', 'Mönch', 97), row('Q16525', 'Mönch', 48, { type: 'Q8502', country: 'Q39', coord: true })]
    expect(order(place('Mönch'), byLabel('Q733786', 'Q16525'), rows)).toEqual(['Q16525', 'Q733786'])
  })
  it('Koblenz: the Swiss municipality (34) beats the German city (116), more so with a canton code', () => {
    const rows = [
      row('Q3104', 'Koblenz', 116, { country: 'Q183', coord: true }),
      row('Q69441', 'Koblenz', 34, { type: 'Q70208', country: 'Q39', coord: true }),
    ]
    const hits = byLabel('Q3104', 'Q69441')
    expect(order(place('Koblenz'), hits, rows)).toEqual(['Q69441', 'Q3104'])
    const plain = rankTerm(place('Koblenz'), hits, parseDetails(rows), 'Q39').candidates[0].score
    const withCanton = rankTerm(place('Koblenz', { swiss: true }), hits, parseDetails(rows), 'Q39').candidates[0].score
    expect(withCanton).toBeGreaterThan(plain)
    expect(order(place('Koblenz'), hits, rows, null)).toEqual(['Q3104', 'Q69441'])
  })
})

describe('ranking rules', () => {
  it('picks the person whose life dates match the file name, whatever the search order', () => {
    const term: SearchTerm = { text: 'Carl Schröter', kind: 'person', source: 'file name', born: 1855, died: 1939 }
    const rows = [
      row('Q110903', 'Carl Schröter', 6, { type: 'Q5', born: '1887-01-01T00:00:00Z', died: '1952-01-01T00:00:00Z' }),
      row('Q2000002', 'Carl Joseph Schröter', 12, { type: 'Q5', born: '1855-12-19T00:00:00Z', died: '1939-02-07T00:00:00Z' }),
    ]
    const group = rankTerm(term, byLabel('Q110903', 'Q2000002'), parseDetails(rows), 'Q39')
    expect(group.candidates[0].qid).toBe('Q2000002')
    expect(group.candidates[0].reasons).toContain('born 1855, as in the file name')
    expect(group.candidates[1].reasons).toEqual(
      expect.arrayContaining(['born 1887, file name says 1855', 'died 1952, file name says 1939']),
    )
  })
  it('merges an item found by both searches and keeps the term as its origin', () => {
    const rows = [row('Q16590', 'Ortstock', 20, { country: 'Q39', coord: true })]
    const term = place('Ortstock', { source: 'file name, part 1 of 2', caution: 'Check.' })
    const group = rankTerm(term, [...byLabel('Q16590'), ...byText('Q16590')], parseDetails(rows), 'Q39')
    expect(group).toMatchObject({ title: '“Ortstock”', source: 'file name, part 1 of 2', caution: 'Check.' })
    expect(group.candidates).toHaveLength(1)
    expect(group.candidates[0].origin).toBe('file name, part 1 of 2')
    expect(group.candidates[0].reasons).toEqual(
      expect.arrayContaining(['label is exactly the term', 'label search, hit 1', 'full-text search in Q39, hit 1']),
    )
  })
  it('uses the label of the search hit when QLever has none, and caps the list', () => {
    const hits: Hit[] = Array.from({ length: 6 }, (_, rank) => ({ qid: `Q90000${rank}`, via: 'label', rank, label: `Hit ${rank}` }))
    const group = rankTerm(place('Hit'), hits, new Map(), null)
    expect(group.candidates).toHaveLength(4)
    expect(group.candidates[0]).toMatchObject({ qid: 'Q900000', label: 'Hit 0' })
  })
  it('keeps only located items in the preferred country for a weak description term', () => {
    const rows = [
      row('Q557640', 'Haar', 30, { country: 'Q183', coord: true }),
      row('Q648218', 'Enge', 20, { country: 'Q39', coord: true }),
      row('Q16869824', 'Enge', 2, { type: 'Q101352' }),
    ]
    expect(order(place('Haar', { strict: true }), byLabel('Q557640'), rows)).toEqual([])
    expect(order(place('Enge', { strict: true }), byLabel('Q16869824', 'Q648218'), rows)).toEqual(['Q648218'])
    expect(order(place('Enge'), byLabel('Q16869824', 'Q648218'), rows)).toEqual(['Q648218', 'Q16869824'])
  })
  it('gives an empty list when nothing was found', () => {
    expect(rankTerm(place('Haus Bösch'), [], new Map(), 'Q39').candidates).toEqual([])
  })
})

describe('a guessed person name', () => {
  it('keeps only humans ("Steckborn, Untersee" gave a monastery)', () => {
    const rows = [row('Q11111', 'Kloster Feldbach', 10, { country: 'Q39', coord: true }), row('Q55684024', 'Robert Breitinger', 2, { type: 'Q5' })]
    const guess = (text: string): SearchTerm => ({ text, kind: 'text', source: 'file name read as "Surname, Forename"', humanOnly: true })
    expect(order(guess('Untersee Steckborn'), byText('Q11111'), rows)).toEqual([])
    expect(order(guess('Robert Breitinger'), byLabel('Q55684024'), rows)).toEqual(['Q55684024'])
  })
})

describe('rejected candidates', () => {
  it('puts an item rejected for the same term last, with the reason', () => {
    // Live run of 12 November 2026: the Swiss castle ranked first for a castle in Freyburg (Germany).
    const rows = [
      row('Q1000101', 'Schloss Neuenburg', 40, { country: 'Q39', coord: true }),
      row('Q1000102', 'Schloss Neuenburg', 30, { country: 'Q183', coord: true }),
    ]
    const term = place('Schloss Neuenburg')
    const hits = byLabel('Q1000101', 'Q1000102')
    expect(order(term, hits, rows)).toEqual(['Q1000101', 'Q1000102'])
    const group = rankTerm(term, hits, parseDetails(rows), 'Q39', new Set(['Q1000101']))
    expect(group.candidates.map((c) => c.qid)).toEqual(['Q1000102', 'Q1000101'])
    expect(group.candidates[1].reasons).toContain('marked "not this" for “Schloss Neuenburg” on another file')
  })
  it('keeps a rejected item out of the agreement group', () => {
    const c = (score: number) => ({ qid: 'Q1', label: 'Q1', description: null, typeLabels: [], score, origin: '', reasons: [] })
    const groups: Group[] = [
      { title: '“A”', source: 'file name', candidates: [c(-95)] },
      { title: 'Same collection', source: 'what other files of this collection depict', candidates: [c(1)] },
    ]
    expect(consensusGroup(groups)).toBeNull()
  })
})

describe('whole-word matching for description terms', () => {
  it('compares words, ignoring case and hyphens', () => {
    expect(containsWords('General-Guisan-Quai', 'General Guisan-Quai')).toBe(true)
    expect(containsWords('Bahnhof Zürich Enge', 'Enge')).toBe(true)
    expect(containsWords('Fritz Wunderlich', 'Fritz Wunderli')).toBe(false)
    expect(containsWords('Schweizerisches Kamm-Museum', 'Haar')).toBe(false)
    expect(containsWords('anything', '')).toBe(false)
  })
  // Hits from the live run of 12 November 2026.
  it('drops the opera singer for "Fritz Wunderli" and keeps an exact match', () => {
    const rows = [row('Q77011', 'Fritz Wunderlich', 60, { type: 'Q5' }), row('Q648218', 'Enge', 20, { country: 'Q39', coord: true })]
    expect(order(place('Fritz Wunderli', { wholeWord: true }), byLabel('Q77011'), rows)).toEqual([])
    expect(order(place('Enge', { wholeWord: true }), byLabel('Q648218'), rows)).toEqual(['Q648218'])
  })
})

describe('consensusGroup', () => {
  const candidate = (qid: string, description: string | null = null) => ({
    qid,
    label: qid,
    description,
    typeLabels: [],
    score: 1,
    origin: 'x',
    reasons: [],
  })
  const group = (title: string, source: string, qids: string[]): Group => ({ title, source, candidates: qids.map((q) => candidate(q)) })

  it('lists items that two kinds of source agree on, most sources first', () => {
    const groups = [
      group('Commons categories', 'categories of this file', ['Q134437168']),
      group('“Dolder Waldhaus”', 'file name', ['Q134437168', 'Q33516079']),
      group('“Enge”', 'Commons description, a district of Zürich', ['Q648218']),
      group('Same collection', 'what other files of this collection depict', ['Q648218', 'Q134437168']),
    ]
    const agreed = consensusGroup(groups)!
    expect(agreed.title).toBe(CONSENSUS_TITLE)
    expect(agreed.candidates.map((c) => [c.qid, c.origin])).toEqual([
      ['Q134437168', 'found by: Commons category, file name, earlier decisions'],
      ['Q648218', 'found by: description, earlier decisions'],
    ])
  })
  it('does not count two terms of the same file name twice', () => {
    expect(
      consensusGroup([group('“Sihl”', 'file name, part 2 of 2', ['Q660909']), group('“Papiermühle”', 'file name', ['Q660909'])]),
    ).toBeNull()
  })
})

describe('categoryGroup', () => {
  it('lists the items of the categories with the category as origin', () => {
    const details = parseDetails([row('Q134437168', 'Waldhaus Dolder', 2, { type: 'Q41176', country: 'Q39', coord: true })])
    const group = categoryGroup([{ category: 'Waldhaus Dolder', qid: 'Q134437168' }, { category: 'Heating stoves', qid: 'Q203789' }], details)
    expect(group?.title).toBe('Commons categories')
    expect(group?.candidates[0]).toMatchObject({
      qid: 'Q134437168',
      label: 'Waldhaus Dolder',
      origin: 'Commons category "Waldhaus Dolder"',
    })
    expect(group?.candidates[1]).toMatchObject({ qid: 'Q203789', label: 'Heating stoves' })
  })
  it('is left out when the file has no linked category', () => {
    expect(categoryGroup([], new Map())).toBeNull()
  })
})

describe('arrangeGroups', () => {
  const c = (qid: string) => ({ qid, label: qid, description: null, typeLabels: [], score: 1, origin: '', reasons: [] })
  const g = (title: string, source: string, qids: string[]): Group => ({ title, source, candidates: qids.map(c) })
  it('puts earlier decisions before the file name and the description last, with measured rates', () => {
    const arranged = arrangeGroups(
      null,
      g('Same collection', 'what other files of this collection depict', ['Q648218']),
      [g('“Enge”', 'Commons description, a district of Zürich', ['Q9']), g('“Haus Bösch”', 'file name', ['Q8'])],
      g('Address in the description', 'street address (P6375) on Wikidata', ['Q7']),
    )
    expect(arranged.map((x) => x.title)).toEqual(['Same collection', '“Haus Bösch”', 'Address in the description', '“Enge”'])
    expect(arranged.map((x) => x.measured)).toEqual([
      'first item right in 77% of tests',
      'first item right in 42% of tests',
      undefined,
      'first item right in 7% of tests',
    ])
  })
  it('starts with the agreement group when two sources agree', () => {
    const arranged = arrangeGroups(
      g('Commons categories', 'categories of this file', ['Q1']),
      g('Same collection', 'what other files of this collection depict', ['Q1']),
      [],
      null,
    )
    expect(arranged[0]).toMatchObject({ title: CONSENSUS_TITLE, measured: 'first item right in 97% of tests' })
  })
})
