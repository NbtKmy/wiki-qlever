import { EXCLUDED_COLLECTION, type Region } from './config'
import type { LonLat } from './geo'

export type Candidate = { pageId: number; subject: LonLat }

const ENDPOINT = 'https://qlever.dev/api/wikimedia-commons'

export function buildCandidatesQuery(region: Region): string {
  const { west, south, east, north } = region.bbox
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?m ?c WHERE {
  ?m wdt:P9149 ?c .
  FILTER NOT EXISTS { ?m wdt:P1259 ?x }
  FILTER NOT EXISTS { ?m wdt:P195 <http://www.wikidata.org/entity/${EXCLUDED_COLLECTION}> }
  BIND(xsd:double(STRBEFORE(STRAFTER(STR(?c), "POINT("), " ")) AS ?lon)
  BIND(xsd:double(STRBEFORE(STRAFTER(STR(?c), " "), ")")) AS ?lat)
  FILTER(?lon >= ${west} && ?lon <= ${east} && ?lat >= ${south} && ?lat <= ${north})
} ORDER BY RAND() LIMIT ${region.limit}`
}

type Binding = { m?: { value: string }; c?: { value: string } }

export function parseCandidates(json: unknown): Candidate[] {
  const bindings = (json as { results?: { bindings?: Binding[] } }).results?.bindings ?? []
  const candidates: Candidate[] = []
  for (const b of bindings) {
    const id = b.m?.value.match(/\/M(\d+)$/)
    const point = b.c?.value.match(/^POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/)
    if (!id || !point) continue
    candidates.push({ pageId: Number(id[1]), subject: { lon: Number(point[1]), lat: Number(point[2]) } })
  }
  return candidates
}

export async function fetchCandidates(region: Region, signal?: AbortSignal): Promise<Candidate[]> {
  const url = `${ENDPOINT}?${new URLSearchParams({ query: buildCandidatesQuery(region) })}`
  const response = await fetch(url, { headers: { Accept: 'application/sparql-results+json' }, signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return parseCandidates(await response.json())
}
