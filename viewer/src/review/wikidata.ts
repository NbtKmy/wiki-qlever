// Step 3 of the pipeline: collect candidate items for a file and rank them.
// Candidates come from the Wikidata search APIs (search.ts) and from the file's Commons categories
// (categories.ts). Their properties come from QLever in one request per file; type labels come from
// a second, cached request, because asking for them inside the main query made it about 30 times
// slower (4 to 6 s against 0.2 s, measured on qlever.dev on 12 November 2026).

import type { CategoryItem } from './categories'
import type { FileContext } from './context'
import { sparql, WIKIDATA_ENDPOINT, type Binding } from './qlever'
import { searchTerm, type Hit } from './search'
import type { SearchTerm } from './titleParse'

export const PER_TERM = 4

export type Details = {
  qid: string
  label: string | null
  description: string | null
  sitelinks: number
  types: Map<string, string>
  countries: Set<string>
  /** Has a coordinate location (P625): the item is something with a place on the map. */
  located: boolean
  born: number | null
  died: number | null
}

export type Candidate = {
  qid: string
  label: string
  description: string | null
  typeLabels: string[]
  score: number
  /** Where the suggestion comes from, kept in the review log. */
  origin: string
  /** Why this candidate ranks where it does. Shown to the reviewer and kept in the review log. */
  reasons: string[]
}

export type Group = {
  title: string
  source: string
  caution?: string
  candidates: Candidate[]
  /** How often this kind of source had the right item first in the benchmark, if measured. */
  measured?: string
}

/**
 * Benchmark of 13 November 2026: 150 Zentralbibliothek files that curators had annotated, with their
 * depicts hidden and their Commons categories hidden (files still to annotate rarely have one).
 * Share of files where the first candidate of the source was one of the curators' items.
 */
export const MEASURED_PRECISION: Record<string, string> = {
  agreement: 'first item right in 97% of tests',
  'earlier decisions': 'first item right in 77% of tests',
  'file name': 'first item right in 42% of tests',
  description: 'first item right in 7% of tests',
}

// Item types that a search often returns but a photograph almost never depicts.
const NOISE_TYPES = new Set([
  'Q4167410', // Wikimedia disambiguation page
  'Q4167836', // Wikimedia category
  'Q17362920', // Wikimedia duplicated page
  'Q13406463', // Wikimedia list article
  'Q101352', // family name
  'Q202444', // given name
  'Q12308941', // male given name
  'Q11879590', // female given name
  'Q13442814', // scholarly article
  'Q482994', // album
  'Q11424', // film
  'Q7725634', // literary work
  'Q3305213', // painting
])

const HUMAN = 'Q5'
export const SWITZERLAND = 'Q39'

export function buildDetailsQuery(qids: string[]): string {
  return `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
SELECT ?item ?de ?en ?desc ?links ?type ?country ?coord ?born ?died WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(' ')} }
  OPTIONAL { ?item rdfs:label ?de FILTER(LANG(?de) = "de") }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item wikibase:sitelinks ?links }
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?item wdt:P31 ?type }
  OPTIONAL { ?item wdt:P17 ?country }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P569 ?born }
  OPTIONAL { ?item wdt:P570 ?died }
}`
}

export function buildTypeLabelQuery(typeQids: string[]): string {
  return `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX wd: <http://www.wikidata.org/entity/>
SELECT ?type ?typeLabel WHERE {
  VALUES ?type { ${typeQids.map((q) => `wd:${q}`).join(' ')} }
  ?type rdfs:label ?typeLabel .
  FILTER(LANG(?typeLabel) = "en")
}`
}

const qidOf = (uri: string | undefined): string | null => uri?.match(/\/entity\/(Q\d+)$/)?.[1] ?? null
const yearOf = (date: string | undefined): number | null => {
  const match = date?.match(/^(-?\d{1,4})-/)
  return match ? Number(match[1]) : null
}

export function parseTypeLabels(bindings: Binding[]): Map<string, string> {
  const labels = new Map<string, string>()
  for (const b of bindings) {
    const qid = qidOf(b.type?.value)
    if (qid && b.typeLabel) labels.set(qid, b.typeLabel.value)
  }
  return labels
}

export function parseDetails(bindings: Binding[]): Map<string, Details> {
  const items = new Map<string, Details>()
  for (const b of bindings) {
    const qid = qidOf(b.item?.value)
    if (!qid) continue
    let item = items.get(qid)
    if (!item) {
      item = {
        qid,
        label: null,
        description: null,
        sitelinks: 0,
        types: new Map(),
        countries: new Set(),
        located: false,
        born: null,
        died: null,
      }
      items.set(qid, item)
    }
    item.label ??= b.de?.value ?? b.en?.value ?? null
    if (b.desc) item.description = b.desc.value
    if (b.links) item.sitelinks = Math.max(item.sitelinks, Number(b.links.value) || 0)
    const type = qidOf(b.type?.value)
    if (type && !item.types.has(type)) item.types.set(type, type)
    const country = qidOf(b.country?.value)
    if (country) item.countries.add(country)
    if (b.coord) item.located = true
    item.born ??= yearOf(b.born?.value)
    item.died ??= yearOf(b.died?.value)
  }
  return items
}

/** Replaces the type IDs that stand in as labels after parseDetails. */
export function applyTypeLabels(items: Iterable<Details>, labels: Map<string, string>): void {
  for (const item of items) {
    for (const type of item.types.keys()) {
      const label = labels.get(type)
      if (label) item.types.set(type, label)
    }
  }
}

const has = (types: Map<string, string>, wanted: Set<string>) => [...types.keys()].some((t) => wanted.has(t))
const round = (n: number) => Math.round(n * 100) / 100

export function scoreCandidate(item: Details, term: SearchTerm, hits: Hit[], preferCountry: string | null): Candidate {
  const reasons = [`${item.sitelinks} sitelinks`]
  let score = Math.log2(1 + item.sitelinks)
  const label = item.label ?? hits.find((h) => h.label)?.label ?? item.qid

  if (label.toLowerCase() === term.text.toLowerCase()) {
    score += 2
    reasons.push('label is exactly the term')
  }
  for (const hit of hits) {
    if (hit.via === 'label') {
      score += Math.max(0, 3 - hit.rank)
      reasons.push(`label search, hit ${hit.rank + 1}`)
    } else {
      score += Math.max(0, 2 - hit.rank / 2)
      reasons.push(`full-text search${preferCountry ? ` in ${preferCountry}` : ''}, hit ${hit.rank + 1}`)
    }
  }

  const noise = has(item.types, NOISE_TYPES)
  if (noise) {
    score -= 8
    reasons.push('type is rarely what a photo shows')
  }
  // A 'text' term may be a place or a person: it gets the place bonuses but no penalty for people.
  if (term.kind !== 'person' && !noise) {
    if (item.located) {
      score += 2
      reasons.push('has coordinates')
    }
    if (term.kind === 'place' && item.types.has(HUMAN)) score -= 2
    if (preferCountry && item.countries.has(preferCountry)) {
      score += term.swiss && preferCountry === SWITZERLAND ? 6 : 3
      reasons.push(`country is ${preferCountry}`)
    } else if (preferCountry && item.countries.size > 0) {
      // "Birnbaum" the village in Slovenia, "Turnerdenkmal" in Ruhland (live run, 12 Nov 2026).
      score -= 2
      reasons.push(`country is not ${preferCountry}`)
    }
  }
  if (term.kind === 'person') {
    if (item.types.has(HUMAN)) {
      score += 2
      reasons.push('is a person')
    } else {
      score -= 4
    }
    if (term.born !== undefined && item.born !== null) {
      if (item.born === term.born) {
        score += 6
        reasons.push(`born ${item.born}, as in the file name`)
      } else {
        score -= 6
        reasons.push(`born ${item.born}, file name says ${term.born}`)
      }
    }
    if (term.died !== undefined && item.died !== null) {
      if (item.died === term.died) {
        score += 4
        reasons.push(`died ${item.died}, as in the file name`)
      } else {
        score -= 4
        reasons.push(`died ${item.died}, file name says ${term.died}`)
      }
    }
  }
  return {
    qid: item.qid,
    label,
    description: item.description ?? hits.find((h) => h.description)?.description ?? null,
    typeLabels: [...item.types.values()],
    score: round(score),
    origin: term.source,
    reasons,
  }
}

const emptyDetails = (qid: string): Details => ({
  qid,
  label: null,
  description: null,
  sitelinks: 0,
  types: new Map(),
  countries: new Set(),
  located: false,
  born: null,
  died: null,
})

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** "General-Guisan-Quai" contains "General Guisan-Quai"; "Fritz Wunderlich" does not contain "Fritz Wunderli". */
export function containsWords(label: string, term: string): boolean {
  const l = ` ${words(label)} `
  const t = words(term)
  return t.length > 0 && l.includes(` ${t} `)
}

export function rankTerm(
  term: SearchTerm,
  hits: Hit[],
  details: Map<string, Details>,
  preferCountry: string | null,
  rejected: Set<string> = new Set(),
): Group {
  const byItem = new Map<string, Hit[]>()
  for (const hit of hits) byItem.set(hit.qid, [...(byItem.get(hit.qid) ?? []), hit])
  return {
    title: `“${term.text}”`,
    source: term.source,
    ...(term.caution ? { caution: term.caution } : {}),
    candidates: [...byItem]
      .filter(([qid, itemHits]) => {
        const item = details.get(qid)
        if (term.wholeWord) {
          const label = item?.label ?? itemHits.find((h) => h.label)?.label ?? ''
          if (!containsWords(label, term.text)) return false
        }
        if (term.humanOnly && !item?.types.has(HUMAN)) return false
        if (!term.strict) return true
        return !!item && item.located && (!preferCountry || item.countries.has(preferCountry))
      })
      .map(([qid, itemHits]) => {
        const candidate = scoreCandidate(details.get(qid) ?? emptyDetails(qid), term, itemHits, preferCountry)
        if (!rejected.has(qid)) return candidate
        // Kept, but last: the same name may well mean this item in another photograph.
        return {
          ...candidate,
          score: candidate.score - 100,
          reasons: [...candidate.reasons, `marked "not this" for “${term.text}” on another file`],
        }
      })
      .sort((a, b) => b.score - a.score || Number(a.qid.slice(1)) - Number(b.qid.slice(1)))
      .slice(0, PER_TERM),
  }
}

type ListEntry = { qid: string; origin: string; reasons: string[]; score?: number }

/** A group of items that come with their own reason, ranked by that reason's score, then by sitelinks. */
export function listGroup(
  title: string,
  source: string,
  caution: string,
  entries: ListEntry[],
  details: Map<string, Details>,
): Group | null {
  if (entries.length === 0) return null
  return {
    title,
    source,
    caution,
    candidates: entries
      .map((entry) => {
        const item = details.get(entry.qid) ?? emptyDetails(entry.qid)
        return {
          qid: entry.qid,
          label: item.label ?? entry.qid,
          description: item.description,
          typeLabels: [...item.types.values()],
          score: round((entry.score ?? 0) * 10 + Math.log2(1 + item.sitelinks)),
          origin: entry.origin,
          reasons: [...entry.reasons, `${item.sitelinks} sitelinks`],
        }
      })
      .sort((a, b) => b.score - a.score),
  }
}

export function categoryGroup(categories: CategoryItem[], details: Map<string, Details>): Group | null {
  const group = listGroup(
    'Commons categories',
    'categories of this file',
    'A category says what a file belongs to. Check that the item is what the photo shows.',
    categories.map(({ category, qid }) => ({ qid, origin: `Commons category "${category}"`, reasons: [`category “${category}”`] })),
    details,
  )
  if (group) for (const c of group.candidates) if (c.label === c.qid) c.label = categories.find((x) => x.qid === c.qid)!.category
  return group
}

const typeLabelCache = new Map<string, string>()

async function fetchDetails(qids: string[], signal?: AbortSignal): Promise<Map<string, Details>> {
  if (qids.length === 0) return new Map()
  const details = parseDetails(await sparql(WIKIDATA_ENDPOINT, buildDetailsQuery(qids), signal, 30_000))
  const unknown = [...new Set([...details.values()].flatMap((d) => [...d.types.keys()]))].filter(
    (t) => !typeLabelCache.has(t),
  )
  if (unknown.length > 0) {
    try {
      const labels = parseTypeLabels(await sparql(WIKIDATA_ENDPOINT, buildTypeLabelQuery(unknown), signal, 15_000))
      // Remember misses too, so a type without an English label is not asked for again.
      for (const type of unknown) typeLabelCache.set(type, labels.get(type) ?? type)
    } catch (error) {
      if (signal?.aborted) throw error
      // The candidates are still useful with type IDs instead of names.
    }
  }
  applyTypeLabels(details.values(), typeLabelCache)
  return details
}

/** At most this many searches per file: each sends two or three requests to the Wikidata API. */
export const MAX_SEARCHES = 7

/**
 * Everything the page shows for one file, in this order: items of its Commons categories, buildings at
 * an address in its description, the search terms of the file name and of the description, and what
 * other files of the collection with similar titles depict.
 */
export async function suggest(
  terms: SearchTerm[],
  context: FileContext,
  preferCountry: string | null,
  signal?: AbortSignal,
  rejections: Map<string, Set<string>> = new Map(),
): Promise<Group[]> {
  const fromTitle = terms.map((t) => t.text.toLowerCase())
  const allTerms = [...terms, ...context.descriptionTerms.filter((t) => !fromTitle.includes(t.text.toLowerCase()))].slice(
    0,
    MAX_SEARCHES,
  )
  // One term after the other: each term already sends two or three requests to the Wikidata API.
  const found: Hit[][] = []
  for (const term of allTerms) found.push(await searchTerm(term.text, preferCountry, signal))
  const qids = [
    ...new Set([
      ...found.flat().map((h) => h.qid),
      ...context.categories.map((c) => c.qid),
      ...context.addressItems.map((a) => a.qid),
      ...context.memory.map((m) => m.qid),
    ]),
  ]
  const details = await fetchDetails(qids, signal)
  const addressGroup = listGroup(
    'Address in the description',
    'street address (P6375) on Wikidata',
    'The building at this address today may not be the one in the photo.',
    context.addressItems.map((a) =>
      a.street
        ? { qid: a.qid, origin: `street "${a.address}" in the Commons description`, reasons: [`street of the address; no building with this number on Wikidata`] }
        : { qid: a.qid, origin: `address "${a.address}" in the Commons description`, reasons: [`address ${a.address}`] },
    ),
    details,
  )
  const memoryGroup = listGroup(
    'Same collection',
    'what other files of this collection depict',
    'Often the district or a general class (building, flowers). Check that it fits this photo.',
    context.memory.map((m) => ({ qid: m.qid, origin: 'earlier decisions in the same collection', reasons: [m.reason], score: m.score })),
    details,
  )
  const termGroups = allTerms.map((term, i) =>
    rankTerm(term, found[i], details, preferCountry, rejections.get(term.text.toLowerCase())),
  )
  return arrangeGroups(categoryGroup(context.categories, details), memoryGroup, termGroups, addressGroup)
}

/**
 * The card's order, by how often each source was right in the benchmark: agreement (97%), categories,
 * earlier decisions of the collection (77%), the file name (42%), addresses, the description (7%).
 * Moving the collection memory up from last place raised the share of right first candidates from
 * about 52% to about 69% in a replay of the benchmark.
 */
export function arrangeGroups(
  categories: Group | null,
  memory: Group | null,
  terms: Group[],
  address: Group | null,
): Group[] {
  const groups = [
    categories,
    memory,
    ...terms.filter((g) => sourceKind(g) === 'file name'),
    address,
    ...terms.filter((g) => sourceKind(g) === 'description'),
  ].filter((g): g is Group => g !== null)
  const agreed = consensusGroup(groups)
  const all = agreed ? [agreed, ...groups] : groups
  for (const g of all) {
    const measured = MEASURED_PRECISION[g.title === CONSENSUS_TITLE ? 'agreement' : sourceKind(g)]
    if (measured) g.measured = measured
  }
  return all
}

/** What kind of evidence a group is, so that two search terms from the same file name count once. */
export function sourceKind(group: Group): string {
  if (group.title === 'Commons categories') return 'Commons category'
  if (group.title === 'Address in the description') return 'address'
  if (group.title === 'Same collection') return 'earlier decisions'
  return group.source.startsWith('Commons description') ? 'description' : 'file name'
}

export const CONSENSUS_TITLE = 'Found by several sources'

/**
 * Items that two or more independent sources agree on ("Waldhaus Dolder" from a category and from
 * the file name). Shown first: agreement is the best signal the page has.
 */
export function consensusGroup(groups: Group[]): Group | null {
  const kinds = new Map<string, Set<string>>()
  const best = new Map<string, Candidate>()
  for (const group of groups) {
    for (const candidate of group.candidates) {
      if (candidate.score <= -50) continue
      kinds.set(candidate.qid, (kinds.get(candidate.qid) ?? new Set()).add(sourceKind(group)))
      const known = best.get(candidate.qid)
      if (!known || (known.description === null && candidate.description !== null)) best.set(candidate.qid, candidate)
    }
  }
  const candidates = [...kinds]
    .filter(([, k]) => k.size >= 2)
    .map(([qid, k]) => {
      const c = best.get(qid)!
      return {
        ...c,
        score: k.size,
        origin: `found by: ${[...k].join(', ')}`,
        reasons: [`${k.size} sources: ${[...k].join(', ')}`],
      }
    })
    .sort((a, b) => b.score - a.score || Number(a.qid.slice(1)) - Number(b.qid.slice(1)))
  return candidates.length === 0
    ? null
    : { title: CONSENSUS_TITLE, source: 'the same item from independent sources', candidates }
}

export const wikidataUrl = (qid: string): string => `https://www.wikidata.org/wiki/${qid}`
