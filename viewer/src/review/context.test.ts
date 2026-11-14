import { describe, expect, it } from 'vitest'
import {
  buildAddressQuery,
  buildDescriptionUrl,
  buildStreetQuery,
  parseStreetHits,
  streetOf,
  inNamedTown,
  parseAddressHits,
  parseDescriptions,
  readDescription,
  stripHtml,
} from './description'
import { buildMemory, buildMemoryQuery, parseMemoryRows, recall } from './memory'
import { compoundVariant } from './search'

const WD = 'http://www.wikidata.org/entity/'
const zb = (subject: string, n = '0') => `Zentralbibliothek Zürich - ${subject} - 99100000000${n}5501.jpg`

// Descriptions as returned by the Commons API for Zentralbibliothek files on 12 November 2026.
describe('readDescription', () => {
  it('finds a street address and the district', () => {
    expect(readDescription('Haus Bösch: Mehrfamilienhaus an der Bürglistrasse 26 in Zürich-Enge', 'Haus Bösch')).toEqual({
      addresses: ['Bürglistrasse 26'],
      terms: [{ text: 'Enge', kind: 'place', source: 'Commons description, a district of Zürich', wholeWord: true, strict: true }],
    })
    expect(readDescription('Unfallversicherungsgebäude: Mythenquai 2', 'Unfallversicherungsgebäude').addresses).toEqual(['Mythenquai 2'])
  })
  it('takes quoted names first and ignores words such as "Hintergrund"', () => {
    const read = readDescription('Dampfboot "Helvetia": Raddampfschiff "Helvetia" mit Zürich-Enge im Hintergrund', 'Dampfboot "Helvetia"')
    expect(read.terms).toEqual([])
    const alt = readDescription(
      'Alt. Usterhaus: Abgebildet ist das treppengieblige Haus "Schanzengatter" am Paradeplatz, abgebrochen 1898',
      'Alt. Usterhaus',
    )
    expect(alt.terms.map((t) => [t.text, t.source])).toEqual([
      ['Schanzengatter', 'Commons description, a quoted name'],
      ['Paradeplatz', 'Commons description'],
    ])
  })
  it('finds the place after "beim" and "am"', () => {
    expect(readDescription('Kinder bei Zwinglidenkmal: Zwei Kinder spielen mit dem Schnee beim Zwinglidenkmal', 'Kinder bei Zwinglidenkmal').terms).toEqual([])
    expect(
      readDescription('Turnerdenkmal am Alpenquai: Ansicht des Turner-Denkmals am General Guisan-Quai (bis 1960: Alpenquai)', 'Turnerdenkmal am Alpenquai')
        .terms.map((t) => t.text),
    ).toEqual(['General Guisan-Quai'])
  })
  it('reads the sitter of a portrait as a person', () => {
    const read = readDescription(
      'Pfenninger, Henriette: Porträt von Henriette Pfenninger nach rechts, sitzend; Henriette Pfenninger trägt eine Spange im Haar',
      'Pfenninger, Henriette',
    )
    expect(read.terms.map((t) => [t.text, t.kind, t.strict ?? false])).toEqual([
      ['Henriette Pfenninger', 'person', false],
      ['Haar', 'place', true],
    ])
  })
  it('keeps the first part of a long quoted text and caps the number of terms', () => {
    const read = readDescription(
      'Papiermühle a.d. Sihl: Beschriftung des Kessels in der Bildmitte: "Fritz Wunderli, Maschinenfabrik, Uster (Schweiz)"',
      'Papiermühle a.d. Sihl',
    )
    expect(read.terms.map((t) => t.text)).toEqual(['Fritz Wunderli'])
    expect(readDescription('X: "Aaa" "Bbb" "Ccc" "Ddd" am Eee', 'X').terms).toHaveLength(3)
  })
  it('gives nothing when the description only repeats the title', () => {
    expect(readDescription('Waldhüsli Degenried', 'Waldhüsli Degenried')).toEqual({ terms: [], addresses: [] })
  })
})

describe('descriptions from the Commons API', () => {
  it('asks for the German description of a batch', () => {
    const p = new URL(buildDescriptionUrl([1, 2])).searchParams
    expect(p.get('iiextmetadatafilter')).toBe('ImageDescription')
    expect(p.get('pageids')).toBe('1|2')
  })
  it('strips the HTML and skips files without a description', () => {
    expect(stripHtml('<div lang="de">Mythenquai&nbsp;2 &amp; <b>"x"</b></div>')).toBe('Mythenquai 2 & "x"')
    const out = parseDescriptions({
      query: {
        pages: [
          { pageid: 1, imageinfo: [{ extmetadata: { ImageDescription: { value: '<p>Haus Bösch</p>' } } }] },
          { pageid: 2, imageinfo: [{ extmetadata: {} }] },
          { pageid: 3 },
        ],
      },
    })
    expect(Object.fromEntries(out)).toEqual({ 1: 'Haus Bösch' })
  })
})

describe('addresses', () => {
  it('matches the address at the start of P6375 in the preferred country', () => {
    const q = buildAddressQuery(['Mythenquai 2', 'Bürglistrasse 26'], 'Q39')
    expect(q).toContain('VALUES ?q { "Mythenquai 2" "Bürglistrasse 26" }')
    expect(q).toContain('FILTER(STRSTARTS(STR(?a), ?q))')
    expect(q).toContain('?i wdt:P17 wd:Q39 .')
    expect(buildAddressQuery(['A 1'], null)).not.toContain('P17')
  })
  it('asks for the town of each building', () => {
    expect(buildAddressQuery(['A 1'], 'Q39')).toContain('?town wdt:P31 wd:Q70208 .')
  })
  it('keeps "Mythenquai 2, 8002 Zürich" and drops "Mythenquai 20"', () => {
    const row = (q: string, i: string, a: string) => ({ q: { value: q }, i: { value: WD + i }, a: { value: a }, townLabel: { value: 'Zürich' } })
    expect(
      parseAddressHits([
        row('Mythenquai 2', 'Q130362399', 'Mythenquai 2, 8002 Zürich'),
        row('Mythenquai 2', 'Q29933668', 'Mythenquai 2'),
        row('Mythenquai 2', 'Q1', 'Mythenquai 20'),
        row('Mythenquai 2', 'Q2', 'Mythenquai 2a'),
        row('Mythenquai 2', 'Q29933668', 'Mythenquai 2'),
      ]),
    ).toEqual([
      { address: 'Mythenquai 2', qid: 'Q130362399', town: 'Zürich' },
      { address: 'Mythenquai 2', qid: 'Q29933668', town: 'Zürich' },
    ])
  })
  // Hits returned by qlever.dev on 12 November 2026.
  const dottikon = { address: 'Schulhausstrasse 18', qid: 'Q112107166', town: 'Dottikon' }
  const grosswangen = { address: 'Schulhausstrasse 18', qid: 'Q29785569', town: 'Grosswangen' }
  const zurich = [
    { address: 'Mythenquai 2', qid: 'Q130362399', town: 'Zürich' },
    { address: 'Mythenquai 2', qid: 'Q29933668', town: 'Zürich' },
  ]
  it('drops buildings in towns the text does not name', () => {
    const text = 'Cyclame: Blumentopf auf einem Holztisch, aufgenommen bei der Schulhausstrasse 18 in Zürich-Enge'
    expect(inNamedTown([dottikon, grosswangen], text)).toEqual([])
    expect(inNamedTown([dottikon, grosswangen], 'Schulhausstrasse 18 in Dottikon')).toEqual([dottikon])
  })
  it('keeps buildings that all lie in one town when the text names none', () => {
    expect(inNamedTown(zurich, 'Unfallversicherungsgebäude: Mythenquai 2')).toEqual(zurich)
    expect(inNamedTown([{ ...dottikon, town: null }], 'Schulhausstrasse 18')).toEqual([])
  })
})

describe('streets', () => {
  it('takes the street from an address', () => {
    expect(streetOf('Bürglistrasse 26')).toBe('Bürglistrasse')
    expect(streetOf('Mythenquai 2a')).toBe('Mythenquai')
  })
  it('looks the street up by its German label, with its town', () => {
    const q = buildStreetQuery(['Bürglistrasse'], 'Q39')
    expect(q).toContain('VALUES ?q { "Bürglistrasse"@de }')
    expect(q).toContain('?i rdfs:label ?q .')
    expect(q).toContain('?town wdt:P31 wd:Q70208 .')
  })
  it('marks the hits as streets', () => {
    expect(
      parseStreetHits([
        { q: { value: 'Bürglistrasse' }, i: { value: WD + 'Q27331001' }, townLabel: { value: 'Zürich' } },
        { q: { value: 'Bürglistrasse' }, i: { value: WD + 'Q27331001' }, townLabel: { value: 'Zürich' } },
      ]),
    ).toEqual([{ address: 'Bürglistrasse', qid: 'Q27331001', town: 'Zürich', street: true }])
  })
})

describe('compoundVariant', () => {
  it('hyphenates German compounds before a known head', () => {
    expect(compoundVariant('Zwinglidenkmal')).toBe('Zwingli-Denkmal')
    expect(compoundVariant('Turnerdenkmal')).toBe('Turner-Denkmal')
    expect(compoundVariant('Paradeplatz')).toBe('Parade-Platz')
  })
  it('leaves other words alone', () => {
    expect(compoundVariant('Denkmal')).toBeNull()
    expect(compoundVariant('Waldhaus Dolder')).toBeNull()
    expect(compoundVariant('Zwingli-Denkmal')).toBeNull()
    expect(compoundVariant('Birnbaum')).toBeNull()
  })
})

describe('collection memory', () => {
  const rows: [string, string][] = [
    [zb('Sihl bei Hochwasser', '1'), 'Q660909'],
    [zb('Sihl bei Hochwasser', '1'), 'Q1000'],
    [zb('Eisgang auf der Sihl', '2'), 'Q660909'],
    [zb('Sihlbrücke und Sihl', '3'), 'Q660909'],
    [zb('Sihl-Allmend', '4'), 'Q2000'],
    [zb('Waldhüsli am Zürichberg', '5'), 'Q3000'],
    [zb('Dampfboot "Helvetia"', '6'), 'Q4000'],
    [zb('Dampfboot "Helvetia"', '6'), 'Q5000'],
  ]
  const memory = buildMemory(rows)

  it('asks for every depicts statement of the collection', () => {
    expect(buildMemoryQuery('Q190260')).toContain('?m wdt:P195 wd:Q190260 .')
    expect(() => buildMemoryQuery('Q1 } x')).toThrow()
  })
  it('suggests what most titles with the same word depict ("Sihl-Allmend" counts as a title with "sihl")', () => {
    const [first] = recall(memory, zb('Papiermühle a.d. Sihl'))
    expect(first).toMatchObject({ qid: 'Q660909', reason: '3 of 4 titles with “sihl” depict it' })
  })
  it('ignores a word that only one earlier file has', () => {
    expect(recall(memory, zb('Waldhüsli Degenried'))).toEqual([])
  })
  it('uses a file with exactly the same title', () => {
    expect(recall(memory, zb('Dampfboot "Helvetia"', '9')).map((h) => [h.qid, h.reason])).toEqual([
      ['Q4000', 'another file with the same title depicts it'],
      ['Q5000', 'another file with the same title depicts it'],
    ])
  })
  it('reads the rows from QLever', () => {
    expect(
      parseMemoryRows([
        {
          u: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Zentralbibliothek%20Z%C3%BCrich%20-%20Sihl%20-%201.jpg' },
          d: { value: WD + 'Q660909' },
        },
        { u: { value: 'x' }, d: { value: WD + 'Q1' } },
      ]),
    ).toEqual([['Zentralbibliothek Zürich - Sihl - 1.jpg', 'Q660909']])
  })
})
