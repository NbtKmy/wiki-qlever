// A fourth source: what reviewers already chose for the rest of the collection. In the Zentralbibliothek
// collection 6,539 of 7,224 files have depicts statements (12 November 2026). When most files whose
// title contains "Sihl" depict the river Sihl, a new "Papiermühle a.d. Sihl" probably does too.
// A single earlier file proves nothing, so a word needs at least two files that agree.

import { COMMONS_ENDPOINT, sparql, type Binding } from './qlever'
import { subjectFromFileName } from './titleParse'

export type Memory = {
  byTitle: Map<string, Set<string>>
  wordIndex: Map<string, string[]>
  itemFrequency: Map<string, number>
}

export type MemoryHit = { qid: string; score: number; reason: string }

export const MEMORY_HITS = 3
const MIN_FILES = 2
const MIN_SHARE = 0.3
/** A word in more titles than this ("Zürich", "Strasse") says little about one file. */
const MAX_TITLES_PER_WORD = 60
const STOP = new Set(['zürich', 'zurich', 'und', 'mit', 'von', 'bei', 'beim', 'der', 'die', 'das', 'des', 'dem', 'den', 'eine', 'einer', 'nach', 'gegen', 'haus', 'alte', 'alter', 'altes', 'neue', 'neuer', 'neues'])

export function buildMemoryQuery(collection: string): string {
  if (!/^Q[1-9]\d*$/.test(collection)) throw new Error(`"${collection}" is not a Wikidata item ID`)
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX schema: <http://schema.org/>
SELECT ?u ?d WHERE {
  ?m wdt:P195 wd:${collection} .
  ?m wdt:P180 ?d .
  ?m schema:url ?u .
} LIMIT 60000`
}

const titleKey = (fileName: string) => subjectFromFileName(fileName).toLowerCase()
const wordsOf = (key: string) =>
  [...new Set(key.split(/[^\p{L}]+/u).filter((w) => w.length >= 4 && !STOP.has(w)))]

export function buildMemory(rows: [fileName: string, qid: string][]): Memory {
  const byTitle = new Map<string, Set<string>>()
  for (const [fileName, qid] of rows) {
    const key = titleKey(fileName)
    if (!key) continue
    let items = byTitle.get(key)
    if (!items) byTitle.set(key, (items = new Set()))
    items.add(qid)
  }
  const wordIndex = new Map<string, string[]>()
  const itemFrequency = new Map<string, number>()
  for (const [key, items] of byTitle) {
    for (const word of wordsOf(key)) {
      const list = wordIndex.get(word)
      if (list) list.push(key)
      else wordIndex.set(word, [key])
    }
    for (const qid of items) itemFrequency.set(qid, (itemFrequency.get(qid) ?? 0) + 1)
  }
  return { byTitle, wordIndex, itemFrequency }
}

export function parseMemoryRows(bindings: Binding[]): [string, string][] {
  return bindings.flatMap((b) => {
    const url = b.u?.value
    const qid = b.d?.value.match(/\/entity\/(Q\d+)$/)?.[1]
    const at = url?.indexOf('Special:FilePath/') ?? -1
    if (!url || !qid || at < 0) return []
    try {
      return [[decodeURIComponent(url.slice(at + 'Special:FilePath/'.length)).replace(/_/g, ' '), qid] as [string, string]]
    } catch {
      return []
    }
  })
}

export function recall(memory: Memory, fileName: string): MemoryHit[] {
  const key = titleKey(fileName)
  const titles = memory.byTitle.size
  const score = new Map<string, number>()
  const reasons = new Map<string, string[]>()
  const vote = (qid: string, points: number, reason: string) => {
    score.set(qid, (score.get(qid) ?? 0) + points)
    reasons.set(qid, [...(reasons.get(qid) ?? []), reason])
  }
  const same = memory.byTitle.get(key)
  if (same) for (const qid of same) vote(qid, 6, 'another file with the same title depicts it')
  for (const word of wordsOf(key)) {
    const withWord = memory.wordIndex.get(word) ?? []
    if (withWord.length < MIN_FILES || withWord.length > MAX_TITLES_PER_WORD) continue
    const counts = new Map<string, number>()
    for (const title of withWord) for (const qid of memory.byTitle.get(title) ?? []) counts.set(qid, (counts.get(qid) ?? 0) + 1)
    for (const [qid, n] of counts) {
      const share = n / withWord.length
      if (n < MIN_FILES || share < MIN_SHARE) continue
      const rarity = Math.min(4, Math.log(titles / (memory.itemFrequency.get(qid) ?? 1)))
      vote(qid, share * rarity, `${n} of ${withWord.length} titles with “${word}” depict it`)
    }
  }
  return [...score]
    .sort((a, b) => b[1] - a[1] || Number(a[0].slice(1)) - Number(b[0].slice(1)))
    .slice(0, MEMORY_HITS)
    .map(([qid, s]) => ({ qid, score: Math.round(s * 100) / 100, reason: (reasons.get(qid) ?? []).join('; ') }))
}

const memories = new Map<string, Promise<Memory>>()

/** One query per collection and visit (about 1 s and 12,651 rows for the Zentralbibliothek). */
export function loadMemory(collection: string, signal?: AbortSignal): Promise<Memory> {
  let memory = memories.get(collection)
  if (!memory) {
    memory = sparql(COMMONS_ENDPOINT, buildMemoryQuery(collection), signal, 60_000).then((b) => buildMemory(parseMemoryRows(b)))
    memories.set(collection, memory)
    memory.catch(() => memories.delete(collection))
  }
  return memory
}
