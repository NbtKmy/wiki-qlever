import { describe, expect, it } from 'vitest'
import {
  buildCategoryItemsUrl,
  buildFileCategoriesUrl,
  buildTopicQuery,
  combine,
  parseCategoryItems,
  parseFileCategories,
  parseTopics,
} from './categories'
import { buildFileSearchUrl, parseFileSearch } from './gaps'
import { buildFullTextUrl, buildLabelSearchUrl, parseFullText, parseLabelSearch, plainWords } from './search'

const WD = 'http://www.wikidata.org/entity/'
const params = (url: string) => new URL(url).searchParams

describe('Wikidata search', () => {
  it('searches labels and aliases in German', () => {
    const p = params(buildLabelSearchUrl('Kinder'))
    expect(p.get('action')).toBe('wbsearchentities')
    expect(p.get('search')).toBe('Kinder')
    expect(p.get('language')).toBe('de')
    expect(p.get('origin')).toBe('*')
  })
  it('restricts the full-text search to the preferred country', () => {
    expect(params(buildFullTextUrl('Dolder Waldhaus', 'Q39')).get('srsearch')).toBe('Dolder Waldhaus haswbstatement:P17=Q39')
    expect(params(buildFullTextUrl('Dolder Waldhaus', null)).get('srsearch')).toBe('Dolder Waldhaus')
  })
  it('does not let a file name carry search keywords', () => {
    expect(plainWords('Dampfboot "Helvetia"')).toBe('Dampfboot Helvetia')
    expect(plainWords('x haswbstatement:P31=Q5 -y')).toBe('x haswbstatement P31 Q5 y')
  })
  it('parses both answers and keeps the rank', () => {
    expect(
      parseLabelSearch({ search: [{ id: 'Q7569', label: 'child', description: 'human between birth and puberty' }, { id: 'P31' }, { id: 'Q126807' }] }),
    ).toEqual([
      { qid: 'Q7569', via: 'label', rank: 0, label: 'child', description: 'human between birth and puberty' },
      { qid: 'Q126807', via: 'label', rank: 2 },
    ])
    expect(parseFullText({ query: { search: [{ title: 'Q33516079' }, { title: 'Q134437168' }] } })).toEqual([
      { qid: 'Q33516079', via: 'fulltext', rank: 0 },
      { qid: 'Q134437168', via: 'fulltext', rank: 1 },
    ])
    expect(parseLabelSearch({})).toEqual([])
    expect(parseFullText({})).toEqual([])
  })
})

describe('Commons file search', () => {
  it('searches the file namespace with paging', () => {
    const p = params(buildFileSearchUrl('incategory:"Media contributed by the ETH-Bibliothek" Säntis', 20, 40))
    expect(p.get('srnamespace')).toBe('6')
    expect(p.get('sroffset')).toBe('40')
    expect(p.get('srsearch')).toBe('incategory:"Media contributed by the ETH-Bibliothek" Säntis')
  })
  it('reads the page IDs and the next offset', () => {
    expect(parseFileSearch({ continue: { sroffset: 20 }, query: { search: [{ pageid: 5 }, {}, { pageid: 7 }] } })).toEqual({
      pageIds: [5, 7],
      next: 20,
    })
    expect(parseFileSearch({ query: { search: [] } })).toEqual({ pageIds: [], next: null })
  })
})

// Category names, linked items and topics as returned on 12 November 2026 for Zentralbibliothek files.
describe('Commons categories', () => {
  it('asks for the visible categories of a batch of files', () => {
    const p = params(buildFileCategoriesUrl([155152725, 155152782], { clcontinue: 'x|y' }))
    expect(p.get('pageids')).toBe('155152725|155152782')
    expect(p.get('clshow')).toBe('!hidden')
    expect(p.get('clcontinue')).toBe('x|y')
    expect(params(buildCategoryItemsUrl(['Category:Waldhaus Dolder'])).get('ppprop')).toBe('wikibase_item')
  })
  it('resolves a category item to its main topic and drops one without a topic', () => {
    expect(buildTopicQuery(['Q8972677'])).toContain('OPTIONAL { ?c wdt:P301 ?topic }')
    const topics = parseTopics([
      { c: { value: WD + 'Q133825699' }, type: { value: WD + 'Q4167836' } },
      { c: { value: WD + 'Q134437168' }, type: { value: WD + 'Q41176' } },
      { c: { value: WD + 'Q27325735' }, type: { value: WD + 'Q79007' } },
      { c: { value: WD + 'Q8972677' }, topic: { value: WD + 'Q203789' }, type: { value: WD + 'Q4167836' } },
    ])
    expect(Object.fromEntries(topics)).toEqual({
      Q133825699: null,
      Q134437168: 'Q134437168',
      Q27325735: 'Q27325735',
      Q8972677: 'Q203789',
    })
  })
  it('gives each file the items of its linked categories', () => {
    const fileCategories = parseFileCategories({
      query: {
        pages: [
          { pageid: 1, categories: [{ title: 'Category:Breitinger Collection' }] },
          {
            pageid: 2,
            categories: [
              { title: 'Category:1895 in Zürich' },
              { title: 'Category:Breitinger Collection' },
              { title: 'Category:Waldhaus Dolder' },
            ],
          },
          { pageid: 3, categories: [{ title: 'Category:Monuments and memorials in Zürich' }, { title: 'Category:General-Guisan-Quai (Zürich)' }] },
          { pageid: 4 },
        ],
      },
    })
    const categoryItems = parseCategoryItems({
      query: {
        pages: [
          { title: 'Category:Waldhaus Dolder', pageprops: { wikibase_item: 'Q134437168' } },
          { title: 'Category:Monuments and memorials in Zürich', pageprops: { wikibase_item: 'Q133825699' } },
          { title: 'Category:General-Guisan-Quai (Zürich)', pageprops: { wikibase_item: 'Q27325735' } },
          { title: 'Category:Breitinger Collection' },
        ],
      },
    })
    const topics = new Map<string, string | null>([
      ['Q134437168', 'Q134437168'],
      ['Q133825699', null],
      ['Q27325735', 'Q27325735'],
    ])
    expect(Object.fromEntries(combine(fileCategories, categoryItems, topics))).toEqual({
      2: [{ category: 'Waldhaus Dolder', qid: 'Q134437168' }],
      3: [{ category: 'General-Guisan-Quai (Zürich)', qid: 'Q27325735' }],
    })
  })
})
