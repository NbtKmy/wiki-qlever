// A second source of suggestions: the Commons categories a file already has. A category linked to
// a Wikidata item ("Waldhaus Dolder") names the subject far more reliably than the file name does,
// but bulk uploads often carry only a collection category.

import { sparql, WIKIDATA_ENDPOINT, type Binding } from './qlever'

export type CategoryItem = { category: string; qid: string }

const API = 'https://commons.wikimedia.org/w/api.php'
const CATEGORY_CLASS = 'Q4167836' // Wikimedia category

export function buildFileCategoriesUrl(pageIds: number[], cont: Record<string, string> = {}): string {
  return `${API}?${new URLSearchParams({
    action: 'query',
    pageids: pageIds.join('|'),
    prop: 'categories',
    clshow: '!hidden',
    cllimit: 'max',
    format: 'json',
    formatversion: '2',
    origin: '*',
    ...cont,
  })}`
}

type PagesJson = {
  continue?: Record<string, string>
  query?: { pages?: { pageid?: number; title?: string; categories?: { title: string }[]; pageprops?: { wikibase_item?: string } }[] }
}

export function parseFileCategories(json: unknown, into: Map<number, string[]> = new Map()): Map<number, string[]> {
  for (const page of (json as PagesJson).query?.pages ?? []) {
    if (typeof page.pageid !== 'number' || !page.categories) continue
    into.set(page.pageid, [...(into.get(page.pageid) ?? []), ...page.categories.map((c) => c.title)])
  }
  return into
}

export function buildCategoryItemsUrl(titles: string[]): string {
  return `${API}?${new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'pageprops',
    ppprop: 'wikibase_item',
    format: 'json',
    formatversion: '2',
    origin: '*',
  })}`
}

export function parseCategoryItems(json: unknown, into: Map<string, string> = new Map()): Map<string, string> {
  for (const page of (json as PagesJson).query?.pages ?? []) {
    if (page.title && page.pageprops?.wikibase_item) into.set(page.title, page.pageprops.wikibase_item)
  }
  return into
}

export function buildTopicQuery(qids: string[]): string {
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
SELECT ?c ?topic ?type WHERE {
  VALUES ?c { ${qids.map((q) => `wd:${q}`).join(' ')} }
  OPTIONAL { ?c wdt:P301 ?topic }
  OPTIONAL { ?c wdt:P31 ?type }
}`
}

const qidOf = (uri: string | undefined): string | null => uri?.match(/\/entity\/(Q\d+)$/)?.[1] ?? null

/**
 * The item a category stands for: its main topic (P301) when the linked item is a category item,
 * the linked item itself otherwise, and nothing for a category item without a main topic.
 */
export function parseTopics(bindings: Binding[]): Map<string, string | null> {
  const topic = new Map<string, string>()
  const isCategory = new Set<string>()
  const seen = new Set<string>()
  for (const b of bindings) {
    const c = qidOf(b.c?.value)
    if (!c) continue
    seen.add(c)
    const t = qidOf(b.topic?.value)
    if (t) topic.set(c, t)
    if (qidOf(b.type?.value) === CATEGORY_CLASS) isCategory.add(c)
  }
  return new Map([...seen].map((c) => [c, topic.get(c) ?? (isCategory.has(c) ? null : c)]))
}

export function combine(
  fileCategories: Map<number, string[]>,
  categoryItems: Map<string, string>,
  topics: Map<string, string | null>,
): Map<number, CategoryItem[]> {
  const out = new Map<number, CategoryItem[]>()
  for (const [pageId, titles] of fileCategories) {
    const items: CategoryItem[] = []
    for (const title of titles) {
      const linked = categoryItems.get(title)
      const qid = linked ? topics.get(linked) : null
      if (qid && !items.some((i) => i.qid === qid)) items.push({ category: title.replace(/^Category:/, ''), qid })
    }
    if (items.length > 0) out.set(pageId, items)
  }
  return out
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Commons API: HTTP ${response.status}`)
  return response.json()
}

/** Three or four requests for a whole batch of files. */
export async function fetchCategoryItems(pageIds: number[], signal?: AbortSignal): Promise<Map<number, CategoryItem[]>> {
  if (pageIds.length === 0) return new Map()
  const fileCategories = new Map<number, string[]>()
  let cont: Record<string, string> | undefined = {}
  for (let call = 0; cont && call < 5; call++) {
    const json = await getJson(buildFileCategoriesUrl(pageIds, cont), signal)
    parseFileCategories(json, fileCategories)
    cont = (json as PagesJson).continue
  }
  const titles = [...new Set([...fileCategories.values()].flat())]
  const categoryItems = new Map<string, string>()
  for (let i = 0; i < titles.length; i += 50) {
    parseCategoryItems(await getJson(buildCategoryItemsUrl(titles.slice(i, i + 50)), signal), categoryItems)
  }
  const linked = [...new Set(categoryItems.values())]
  const topics = linked.length > 0 ? parseTopics(await sparql(WIKIDATA_ENDPOINT, buildTopicQuery(linked), signal, 20_000)) : new Map()
  return combine(fileCategories, categoryItems, topics)
}
