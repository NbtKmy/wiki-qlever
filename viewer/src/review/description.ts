// A third source: the description of the file on Commons. Zentralbibliothek descriptions name what the
// title only hints at: "Raddampfschiff "Helvetia" mit Zürich-Enge im Hintergrund", "Mehrfamilienhaus an
// der Bürglistrasse 26 in Zürich-Enge", "Mythenquai 2". Street addresses are looked up on Wikidata
// (P6375); quoted names and places after "am", "beim", "in" become search terms.

import { sparql, WIKIDATA_ENDPOINT, type Binding } from './qlever'
import type { SearchTerm } from './titleParse'

export type AddressItem = {
  address: string
  qid: string
  town: string | null
  /** No building with this address is on Wikidata; this is the street itself. */
  street?: boolean
}

const API = 'https://commons.wikimedia.org/w/api.php'
export const MAX_DESCRIPTION_TERMS = 3
export const MAX_ADDRESSES = 2

export function buildDescriptionUrl(pageIds: number[]): string {
  return `${API}?${new URLSearchParams({
    action: 'query',
    pageids: pageIds.join('|'),
    prop: 'imageinfo',
    iiprop: 'extmetadata',
    iiextmetadatafilter: 'ImageDescription',
    iiextmetadatalanguage: 'de',
    format: 'json',
    formatversion: '2',
    origin: '*',
  })}`
}

export const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

type ImageInfoJson = {
  query?: { pages?: { pageid?: number; imageinfo?: { extmetadata?: { ImageDescription?: { value?: unknown } } }[] }[] }
}

export function parseDescriptions(json: unknown, into: Map<number, string> = new Map()): Map<number, string> {
  for (const page of (json as ImageInfoJson).query?.pages ?? []) {
    const value = page.imageinfo?.[0]?.extmetadata?.ImageDescription?.value
    if (typeof page.pageid === 'number' && typeof value === 'string') {
      const text = stripHtml(value)
      if (text) into.set(page.pageid, text)
    }
  }
  return into
}

// Words that follow "im", "am" or "in" in these descriptions without naming anything.
const GENERIC = new Set(
  [
    'Hintergrund', 'Vordergrund', 'Bildhintergrund', 'Bildvordergrund', 'Bildmitte', 'Mitte', 'Titel',
    'Bild', 'Schnee', 'Wasser', 'Winter', 'Sommer', 'Frühling', 'Herbst', 'Jahr', 'Zeit', 'Ort', 'Garten',
    'Haus', 'Gebäude', 'Freien', 'Innern', 'Inneren', 'Atelier', 'Studio', 'Profil', 'Halbprofil',
    'Dreiviertelprofil', 'Ganzfigur', 'Brustbild', 'Kniestück', 'Hochformat', 'Querformat',
  ].map((w) => w.toLowerCase()),
)

const STREET = '(?:strasse|straße|gasse|weg|quai|platz|rain|steig|graben|allee|hof|halde|berg|matt)'
const ADDRESS = new RegExp(`(\\p{Lu}[\\p{L}.-]*${STREET})\\s+(\\d{1,4}[a-z]?)\\b`, 'gu')
const QUOTED = /["„“»«]([^"„“”»«]{3,60})["“”«»]/g
// "in Zürich-Enge": the district alone finds the quarter, the whole name finds the railway station.
const CITY_DISTRICT = /^(?:Zürich|Bern|Basel|Genf|Luzern|Winterthur|Lausanne|Lugano|Biel|Schaffhausen)-(\p{Lu}\p{L}+)$/u
const PORTRAIT = /Porträt (?:von|des|der)\s+(\p{Lu}[\p{L}.]+(?:\s(?:von\s|de\s)?\p{Lu}[\p{L}.]+){1,3})/gu
const AFTER_PREPOSITION =
  /(?:^|[\s,;(])(?:am|an der|an dem|beim|bei der|bei dem|in|im|vor dem|vor der|auf dem|auf der|hinter dem|hinter der)\s+(\p{Lu}[\p{L}'’.]*(?:[- ]\p{Lu}[\p{L}'’.]*){0,2})/gu

/** Search terms and street addresses from a Commons description. */
export function readDescription(description: string, subject: string): { terms: SearchTerm[]; addresses: string[] } {
  let text = description.trim()
  const lowerSubject = subject.toLowerCase().trim()
  if (text.toLowerCase().startsWith(lowerSubject)) text = text.slice(subject.length).replace(/^\s*[:.,-]\s*/, '')
  if (!text) return { terms: [], addresses: [] }

  const addresses: string[] = []
  const streets = new Set<string>()
  for (const match of text.matchAll(ADDRESS)) {
    const address = `${match[1]} ${match[2]}`
    streets.add(match[1].toLowerCase())
    if (!addresses.includes(address)) addresses.push(address)
  }

  const terms: SearchTerm[] = []
  const add = (raw: string, source: string, extra: Partial<SearchTerm> = {}) => {
    let term = raw.split(',')[0].replace(/\s*\([^)]*\)?$/, '').replace(/[.\s]+$/, '').trim()
    const district = term.match(CITY_DISTRICT)
    if (district) {
      source = `${source}, a district of ${term.split('-')[0]}`
      term = district[1]
    }
    const lower = term.toLowerCase()
    if (term.length < 3 || !/\p{L}{3}/u.test(term) || GENERIC.has(lower) || streets.has(lower)) return
    // Already searched as part of the file name.
    if (lowerSubject.includes(lower)) return
    if (terms.some((t) => t.text.toLowerCase() === lower)) return
    terms.push({ text: term, kind: 'place', source, wholeWord: true, ...extra })
  }
  for (const match of text.matchAll(PORTRAIT)) {
    add(match[1], 'Commons description, a portrait', {
      kind: 'person',
      caution: 'Named in the description of a portrait. Check that the item is this person.',
    })
  }
  for (const match of text.matchAll(QUOTED)) add(match[1], 'Commons description, a quoted name')
  // Nouns after "im", "am" are often not names ("im Haar"): only located items in the country are kept.
  for (const match of text.matchAll(AFTER_PREPOSITION)) add(match[1], 'Commons description', { strict: true })
  return { terms: terms.slice(0, MAX_DESCRIPTION_TERMS), addresses: addresses.slice(0, MAX_ADDRESSES) }
}

export function buildAddressQuery(addresses: string[], country: string | null): string {
  const values = addresses.map((a) => `"${a.replace(/["\\]/g, '')}"`).join(' ')
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?q ?i ?a ?townLabel WHERE {
  VALUES ?q { ${values} }
  ?i wdt:P6375 ?a .
  FILTER(STRSTARTS(STR(?a), ?q))${country ? `\n  ?i wdt:P17 wd:${country} .` : ''}
  OPTIONAL {
    ?i wdt:P131* ?town .
    ?town wdt:P31 wd:Q70208 .
    ?town rdfs:label ?townLabel FILTER(LANG(?townLabel) = "de")
  }
} LIMIT 200`
}

/** Keeps "Mythenquai 2, 8002 Zürich" for "Mythenquai 2", drops "Mythenquai 20". */
export function parseAddressHits(bindings: Binding[]): AddressItem[] {
  const out: AddressItem[] = []
  for (const b of bindings) {
    const query = b.q?.value
    const address = b.a?.value
    const qid = b.i?.value.match(/\/entity\/(Q\d+)$/)?.[1]
    if (!query || !address || !qid) continue
    const next = address.charAt(query.length)
    if (next && /[\p{L}\d]/u.test(next)) continue
    if (!out.some((o) => o.address === query && o.qid === qid)) out.push({ address: query, qid, town: b.townLabel?.value ?? null })
  }
  return out
}

/**
 * Every Swiss town has a "Schulhausstrasse 18". Keeps the buildings in a town the text names; when the
 * text names none of their towns, keeps them only if they all lie in one town ("Mythenquai 2": two items,
 * both in Zürich).
 */
export function inNamedTown(hits: AddressItem[], text: string): AddressItem[] {
  const lower = text.toLowerCase()
  const byAddress = new Map<string, AddressItem[]>()
  for (const hit of hits) byAddress.set(hit.address, [...(byAddress.get(hit.address) ?? []), hit])
  return [...byAddress.values()].flatMap((group) => {
    const named = group.filter((h) => h.town && lower.includes(h.town.toLowerCase()))
    if (named.length > 0) return named
    const towns = new Set(group.map((h) => h.town))
    return towns.size === 1 && !towns.has(null) ? group : []
  })
}

/** "Bürglistrasse 26" → "Bürglistrasse". */
export const streetOf = (address: string): string => address.replace(/\s+\d{1,4}[a-z]?$/, '')

export function buildStreetQuery(streets: string[], country: string | null): string {
  const values = streets.map((s) => `"${s.replace(/["\\]/g, '')}"@de`).join(' ')
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?q ?i ?townLabel WHERE {
  VALUES ?q { ${values} }
  ?i rdfs:label ?q .${country ? `\n  ?i wdt:P17 wd:${country} .` : ''}
  OPTIONAL {
    ?i wdt:P131* ?town .
    ?town wdt:P31 wd:Q70208 .
    ?town rdfs:label ?townLabel FILTER(LANG(?townLabel) = "de")
  }
} LIMIT 200`
}

export function parseStreetHits(bindings: Binding[]): AddressItem[] {
  const out: AddressItem[] = []
  for (const b of bindings) {
    const street = b.q?.value
    const qid = b.i?.value.match(/\/entity\/(Q\d+)$/)?.[1]
    if (!street || !qid || out.some((o) => o.qid === qid && o.address === street)) continue
    out.push({ address: street, qid, town: b.townLabel?.value ?? null, street: true })
  }
  return out
}

/** The street, for addresses where Wikidata has no building: a street is still a fair depicts value. */
export async function fetchStreetItems(streets: string[], country: string | null, signal?: AbortSignal): Promise<AddressItem[]> {
  if (streets.length === 0) return []
  return parseStreetHits(await sparql(WIKIDATA_ENDPOINT, buildStreetQuery(streets, country), signal, 20_000))
}

export async function fetchDescriptions(pageIds: number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  for (let i = 0; i < pageIds.length; i += 50) {
    const response = await fetch(buildDescriptionUrl(pageIds.slice(i, i + 50)), { signal })
    if (!response.ok) throw new Error(`Commons API: HTTP ${response.status}`)
    parseDescriptions(await response.json(), out)
  }
  return out
}

export async function fetchAddressItems(
  addresses: string[],
  country: string | null,
  signal?: AbortSignal,
): Promise<AddressItem[]> {
  if (addresses.length === 0) return []
  return parseAddressHits(await sparql(WIKIDATA_ENDPOINT, buildAddressQuery(addresses, country), signal, 20_000))
}
