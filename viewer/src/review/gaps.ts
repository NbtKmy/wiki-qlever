// Step 1 and 2 of the pipeline: select a collection and list its files without a depicts (P180) statement.

import { COMMONS_ENDPOINT, sparql, type Binding } from './qlever'

export type Selector =
  | { kind: 'collection'; qid: string }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'category'; title: string }
  | { kind: 'search'; query: string }

export type GapFile = { pageId: number; title: string }

export type Preset = { id: string; label: string; selector: Selector }

export const PRESETS: Preset[] = [
  {
    id: 'zb',
    label: 'Zentralbibliothek Zürich (collection P195)',
    selector: { kind: 'collection', qid: 'Q190260' },
  },
  // By category, not by the "ETH-BIB-" prefix: not every file has the prefix, and the file-name query
  // slows down with the offset (see docs/depicts-review.md).
  {
    id: 'eth',
    label: 'ETH Library (Commons category)',
    selector: { kind: 'category', title: 'Media contributed by the ETH-Bibliothek' },
  },
]

const FILE_PATH = 'http://commons.wikimedia.org/wiki/Special:FilePath/'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const PREFIXES = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX schema: <http://schema.org/>`

export const isQid = (text: string): boolean => /^Q[1-9]\d*$/.test(text)

export function buildCollectionGapQuery(qid: string, limit: number, offset: number): string {
  if (!isQid(qid)) throw new Error(`"${qid}" is not a Wikidata item ID`)
  return `${PREFIXES}
SELECT ?m ?u WHERE {
  ?m wdt:P195 wd:${qid} .
  ?m schema:url ?u .
  FILTER NOT EXISTS { ?m wdt:P180 ?d }
} ORDER BY ?m LIMIT ${limit} OFFSET ${offset}`
}

// No ORDER BY and no COUNT here: the string filter scans every file and only finishes with a LIMIT
// (docs/collections.md).
export function buildPrefixGapQuery(prefix: string, limit: number, offset: number): string {
  const start = (FILE_PATH + encodeURIComponent(prefix)).replace(/"/g, '%22')
  return `${PREFIXES}
SELECT ?m ?u WHERE {
  ?m schema:url ?u .
  FILTER(STRSTARTS(STR(?u), "${start}"))
  FILTER NOT EXISTS { ?m wdt:P180 ?d }
} LIMIT ${limit} OFFSET ${offset}`
}

export function buildPageIdGapQuery(pageIds: number[]): string {
  const values = pageIds.map((id) => `<https://commons.wikimedia.org/entity/M${id}>`).join(' ')
  return `${PREFIXES}
SELECT ?m ?u WHERE {
  VALUES ?m { ${values} }
  ?m schema:url ?u .
  FILTER NOT EXISTS { ?m wdt:P180 ?d }
}`
}

export function titleFromFilePath(url: string): string | null {
  const at = url.indexOf('Special:FilePath/')
  if (at < 0) return null
  const encoded = url.slice(at + 'Special:FilePath/'.length).split('?')[0]
  try {
    return decodeURIComponent(encoded).replace(/_/g, ' ')
  } catch {
    return encoded.replace(/_/g, ' ')
  }
}

export function parseGapFiles(bindings: Binding[]): GapFile[] {
  const files = new Map<number, GapFile>()
  for (const b of bindings) {
    const id = b.m?.value.match(/\/M(\d+)$/)
    const title = b.u ? titleFromFilePath(b.u.value) : null
    if (!id || !title) continue
    files.set(Number(id[1]), { pageId: Number(id[1]), title })
  }
  return [...files.values()]
}

export function buildCategoryUrl(title: string, limit: number, cmcontinue?: string): string {
  const params = new URLSearchParams({
    action: 'query',
    list: 'categorymembers',
    cmtitle: /^Category:/i.test(title) ? title : `Category:${title}`,
    cmtype: 'file',
    cmlimit: String(Math.min(limit, 500)),
    format: 'json',
    origin: '*',
  })
  if (cmcontinue) params.set('cmcontinue', cmcontinue)
  return `${COMMONS_API}?${params}`
}

/** Full-text search for files on Commons, e.g. `incategory:"Media contributed by the ETH-Bibliothek" Säntis`. */
export function buildFileSearchUrl(query: string, limit: number, offset: number): string {
  return `${COMMONS_API}?${new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: '6',
    srlimit: String(Math.min(limit, 500)),
    sroffset: String(offset),
    srprop: '',
    format: 'json',
    origin: '*',
  })}`
}

type SearchJson = { continue?: { sroffset?: number }; query?: { search?: { pageid?: number }[] } }

export function parseFileSearch(json: unknown): { pageIds: number[]; next: number | null } {
  const data = json as SearchJson
  const pageIds = (data.query?.search ?? []).flatMap((m) => (typeof m.pageid === 'number' ? [m.pageid] : []))
  return { pageIds, next: typeof data.continue?.sroffset === 'number' ? data.continue.sroffset : null }
}

type CategoryJson = {
  continue?: { cmcontinue?: string }
  query?: { categorymembers?: { pageid?: number }[] }
}

export function parseCategoryMembers(json: unknown): { pageIds: number[]; next: string | null } {
  const data = json as CategoryJson
  const pageIds = (data.query?.categorymembers ?? []).flatMap((m) => (typeof m.pageid === 'number' ? [m.pageid] : []))
  return { pageIds, next: data.continue?.cmcontinue ?? null }
}

/** Where the next batch starts: a row offset for SPARQL selectors, a continue token for categories. */
export type Cursor = { offset: number; cmcontinue: string | null; done: boolean }

export const firstCursor = (): Cursor => ({ offset: 0, cmcontinue: null, done: false })

export async function fetchGapBatch(
  selector: Selector,
  batchSize: number,
  cursor: Cursor,
  signal?: AbortSignal,
): Promise<{ files: GapFile[]; scanned: number; cursor: Cursor }> {
  if (selector.kind === 'search') {
    const response = await fetch(buildFileSearchUrl(selector.query, batchSize, cursor.offset), { signal })
    if (!response.ok) throw new Error(`Commons API: HTTP ${response.status}`)
    const { pageIds, next } = parseFileSearch(await response.json())
    const files = pageIds.length > 0 ? parseGapFiles(await sparql(COMMONS_ENDPOINT, buildPageIdGapQuery(pageIds), signal)) : []
    return {
      files,
      scanned: pageIds.length,
      cursor: { offset: next ?? cursor.offset + pageIds.length, cmcontinue: null, done: next === null },
    }
  }
  if (selector.kind === 'category') {
    // Commons categories are not in the QLever index, so the members come from the MediaWiki API
    // and QLever only answers which of them lack a depicts statement.
    const response = await fetch(buildCategoryUrl(selector.title, batchSize, cursor.cmcontinue ?? undefined), { signal })
    if (!response.ok) throw new Error(`Commons API: HTTP ${response.status}`)
    const { pageIds, next } = parseCategoryMembers(await response.json())
    const files = pageIds.length > 0 ? parseGapFiles(await sparql(COMMONS_ENDPOINT, buildPageIdGapQuery(pageIds), signal)) : []
    return {
      files,
      scanned: pageIds.length,
      cursor: { offset: cursor.offset + pageIds.length, cmcontinue: next, done: next === null },
    }
  }
  const query =
    selector.kind === 'collection'
      ? buildCollectionGapQuery(selector.qid, batchSize, cursor.offset)
      : buildPrefixGapQuery(selector.prefix, batchSize, cursor.offset)
  const bindings = await sparql(COMMONS_ENDPOINT, query, signal, 60_000)
  const files = parseGapFiles(bindings)
  return {
    files,
    scanned: bindings.length,
    cursor: { offset: cursor.offset + bindings.length, cmcontinue: null, done: bindings.length < batchSize },
  }
}

export function describeSelector(selector: Selector): string {
  if (selector.kind === 'collection') return `collection (P195) = ${selector.qid}`
  if (selector.kind === 'prefix') return `file names starting with "${selector.prefix}"`
  if (selector.kind === 'search') return `Commons search "${selector.query}"`
  return `Commons category "${selector.title}"`
}
