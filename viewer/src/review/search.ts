// Finds candidate items for a search term with the two Wikidata search APIs.
// An exact-label lookup found nothing for 13 of 20 Zentralbibliothek files (docs/depicts-review.md):
// the label search also matches aliases and word beginnings ("Kinder" finds "child"), and the
// full-text search finds reordered names ("Dolder Waldhaus" finds "Waldhaus Dolder").

export type Hit = {
  qid: string
  via: 'label' | 'fulltext'
  /** Position in the API's own ranking, starting at 0. */
  rank: number
  label?: string
  description?: string
}

const API = 'https://www.wikidata.org/w/api.php'
export const LABEL_HITS = 5
export const FULLTEXT_HITS = 3

export function buildLabelSearchUrl(term: string): string {
  return `${API}?${new URLSearchParams({
    action: 'wbsearchentities',
    search: term,
    language: 'de',
    uselang: 'en',
    type: 'item',
    limit: String(LABEL_HITS),
    format: 'json',
    origin: '*',
  })}`
}

/** Search keywords such as "haswbstatement:" must not come from a file name. */
export const plainWords = (term: string): string => term.replace(/["':()[\]{}!*~^\\/|<>=-]/g, ' ').replace(/\s+/g, ' ').trim()

export function buildFullTextUrl(term: string, country: string | null): string {
  return `${API}?${new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: plainWords(term) + (country ? ` haswbstatement:P17=${country}` : ''),
    srnamespace: '0',
    srlimit: String(FULLTEXT_HITS),
    srprop: '',
    format: 'json',
    origin: '*',
  })}`
}

const isItem = (id: unknown): id is string => typeof id === 'string' && /^Q[1-9]\d*$/.test(id)

type LabelJson = { search?: { id?: string; label?: string; description?: string }[] }
type FullTextJson = { query?: { search?: { title?: string }[] } }

export function parseLabelSearch(json: unknown): Hit[] {
  return ((json as LabelJson).search ?? []).flatMap((s, rank) =>
    isItem(s.id)
      ? [
          {
            qid: s.id,
            via: 'label' as const,
            rank,
            ...(s.label ? { label: s.label } : {}),
            ...(s.description ? { description: s.description } : {}),
          },
        ]
      : [],
  )
}

export function parseFullText(json: unknown): Hit[] {
  return ((json as FullTextJson).query?.search ?? []).flatMap((s, rank) =>
    isItem(s.title) ? [{ qid: s.title, via: 'fulltext' as const, rank }] : [],
  )
}

// "Zwinglidenkmal" finds nothing, "Zwingli-Denkmal" finds the monument (12 Nov 2026).
const HEADS = ['denkmal', 'brunnen', 'kirche', 'kapelle', 'brücke', 'turm', 'schloss', 'bahnhof', 'schulhaus', 'museum', 'theater', 'platz', 'quai', 'strasse']

/** "Zwinglidenkmal" → "Zwingli-Denkmal": German compounds are often hyphenated in Wikidata labels. */
export function compoundVariant(term: string): string | null {
  if (!/^\p{Lu}\p{Ll}+$/u.test(term)) return null
  const lower = term.toLowerCase()
  const head = HEADS.find((h) => lower.endsWith(h) && lower.length - h.length >= 3)
  if (!head) return null
  const stem = term.slice(0, term.length - head.length)
  return `${stem}-${head[0].toUpperCase()}${head.slice(1)}`
}

const cache = new Map<string, Hit[]>()

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(20_000)
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  if (!response.ok) throw new Error(`Wikidata search: HTTP ${response.status}`)
  return response.json()
}

/** Both searches for one term. Results are remembered: a batch often repeats the same term. */
export async function searchTerm(term: string, country: string | null, signal?: AbortSignal): Promise<Hit[]> {
  const key = `${country ?? ''}|${term}`
  const known = cache.get(key)
  if (known) return known
  const variant = compoundVariant(term)
  const [byLabel, byVariant, byText] = await Promise.all([
    getJson(buildLabelSearchUrl(term), signal).then(parseLabelSearch),
    variant ? getJson(buildLabelSearchUrl(variant), signal).then(parseLabelSearch) : [],
    // The full-text search splits "Zwingli-Denkmal" into words, so it gets the variant.
    plainWords(variant ?? term).length >= 3 ? getJson(buildFullTextUrl(variant ?? term, country), signal).then(parseFullText) : [],
  ])
  const hits = [...byLabel, ...byVariant, ...byText]
  cache.set(key, hits)
  return hits
}
