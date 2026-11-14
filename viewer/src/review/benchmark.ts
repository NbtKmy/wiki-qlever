// Measures the suggestions against depicts statements that people already made.
// Take files of a collection that HAVE depicts, hide the statements, run the same pipeline as the
// review page, and compare what it shows with what the curators chose. The collection memory is
// rebuilt without the file under test, so it cannot simply recall the answer.

import type { Candidate, Group } from './wikidata'
import { CONSENSUS_TITLE, sourceKind } from './wikidata'
import type { Binding } from './qlever'

export type AnnotatedFile = { pageId: number; title: string; gold: Set<string> }
export type MemoryRow = { pageId: number; title: string; qid: string }

export function buildAnnotatedQuery(collection: string): string {
  if (!/^Q[1-9]\d*$/.test(collection)) throw new Error(`"${collection}" is not a Wikidata item ID`)
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX schema: <http://schema.org/>
SELECT ?m ?u ?d WHERE {
  ?m wdt:P195 wd:${collection} .
  ?m wdt:P180 ?d .
  ?m schema:url ?u .
} LIMIT 60000`
}

export function parseAnnotated(bindings: Binding[]): { files: AnnotatedFile[]; rows: MemoryRow[] } {
  const files = new Map<number, AnnotatedFile>()
  const rows: MemoryRow[] = []
  for (const b of bindings) {
    const pageId = Number(b.m?.value.match(/\/M(\d+)$/)?.[1])
    const qid = b.d?.value.match(/\/entity\/(Q\d+)$/)?.[1]
    const url = b.u?.value ?? ''
    const at = url.indexOf('Special:FilePath/')
    if (!pageId || !qid || at < 0) continue
    let title: string
    try {
      title = decodeURIComponent(url.slice(at + 'Special:FilePath/'.length)).replace(/_/g, ' ')
    } catch {
      continue
    }
    let file = files.get(pageId)
    if (!file) files.set(pageId, (file = { pageId, title, gold: new Set() }))
    file.gold.add(qid)
    rows.push({ pageId, title, qid })
  }
  return { files: [...files.values()], rows }
}

/** Same seed, same sample: the benchmark can be repeated after a change. */
export function sample<T>(items: T[], n: number, seed: number): T[] {
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

// Kinds of photograph, decided by what the curators said it depicts. The first kind in this order
// that matches any depicts value wins: a portrait in front of a church counts as "people".
export const KINDS = [
  { kind: 'people', classes: ['Q5'] },
  { kind: 'monuments', classes: ['Q4989906', 'Q179700'] }, // monument, statue
  { kind: 'buildings', classes: ['Q811979'] }, // architectural structure
  { kind: 'nature', classes: ['Q271669', 'Q15324', 'Q756'] }, // landform, body of water, plant
  { kind: 'places', classes: ['Q486972', 'Q56061', 'Q79007'] }, // settlement, administrative entity, street
] as const

export type Kind = (typeof KINDS)[number]['kind'] | 'other'

export function buildClassQuery(qids: string[]): string {
  const classes = KINDS.flatMap((k) => k.classes)
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
SELECT DISTINCT ?i ?class WHERE {
  VALUES ?i { ${qids.map((q) => `wd:${q}`).join(' ')} }
  VALUES ?class { ${classes.map((c) => `wd:${c}`).join(' ')} }
  ?i wdt:P31/wdt:P279* ?class .
}`
}

export function parseClasses(bindings: Binding[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const b of bindings) {
    const i = b.i?.value.match(/\/entity\/(Q\d+)$/)?.[1]
    const c = b.class?.value.match(/\/entity\/(Q\d+)$/)?.[1]
    if (i && c) out.set(i, (out.get(i) ?? new Set()).add(c))
  }
  return out
}

export function kindOf(gold: Set<string>, classes: Map<string, Set<string>>): Kind {
  const found = new Set([...gold].flatMap((q) => [...(classes.get(q) ?? [])]))
  return KINDS.find((k) => k.classes.some((c) => found.has(c)))?.kind ?? 'other'
}

export type FileResult = {
  pageId: number
  title: string
  kind: Kind
  gold: string[]
  /** Candidates in the order the card shows them, without repeats. */
  shown: string[]
  top1: boolean
  top3: boolean
  /** A depicts value of the curators appears anywhere on the card. */
  found: boolean
  /** Share of the curators' depicts values that appear on the card. */
  recall: number
  /** Per source kind: did it show anything, did it contain a gold value, was its first candidate gold. */
  sources: Record<string, { shown: boolean; hit: boolean; firstHit: boolean }>
  error?: string
}

export function evaluate(file: AnnotatedFile, kind: Kind, groups: Group[]): FileResult {
  const shown: string[] = []
  for (const group of groups) for (const c of group.candidates) if (!shown.includes(c.qid)) shown.push(c.qid)
  const gold = file.gold
  const sources: FileResult['sources'] = {}
  for (const group of groups) {
    if (group.candidates.length === 0) continue
    const key = group.title === CONSENSUS_TITLE ? 'agreement' : sourceKind(group)
    const entry = (sources[key] ??= { shown: false, hit: false, firstHit: false })
    const firstOfGroup: Candidate | undefined = group.candidates[0]
    entry.shown = true
    entry.hit ||= group.candidates.some((c) => gold.has(c.qid))
    // A source can have several groups (one per search term): its first hit counts once.
    entry.firstHit ||= !!firstOfGroup && gold.has(firstOfGroup.qid)
  }
  const goldShown = [...gold].filter((q) => shown.includes(q)).length
  return {
    pageId: file.pageId,
    title: file.title,
    kind,
    gold: [...gold],
    shown,
    top1: shown.length > 0 && gold.has(shown[0]),
    top3: shown.slice(0, 3).some((q) => gold.has(q)),
    found: goldShown > 0,
    recall: gold.size === 0 ? 0 : goldShown / gold.size,
    sources,
  }
}

export type Summary = {
  files: number
  errors: number
  top1: number
  top3: number
  found: number
  recall: number
  abstained: number
  meanShown: number
}

const share = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10)

/** Percentages with one decimal; errors are left out of the denominators. */
export function summarize(results: FileResult[]): Summary {
  const ok = results.filter((r) => !r.error)
  return {
    files: ok.length,
    errors: results.length - ok.length,
    top1: share(ok.filter((r) => r.top1).length, ok.length),
    top3: share(ok.filter((r) => r.top3).length, ok.length),
    found: share(ok.filter((r) => r.found).length, ok.length),
    recall: share(
      ok.reduce((s, r) => s + r.recall, 0),
      ok.length,
    ),
    abstained: share(ok.filter((r) => r.shown.length === 0).length, ok.length),
    meanShown: ok.length === 0 ? 0 : Math.round((ok.reduce((s, r) => s + r.shown.length, 0) / ok.length) * 10) / 10,
  }
}

export type SourceSummary = { source: string; coverage: number; hitWhenShown: number; firstCorrect: number; files: number }

/** For each source: how often it shows something, and how often that is right. */
export function summarizeSources(results: FileResult[]): SourceSummary[] {
  const ok = results.filter((r) => !r.error)
  const names = [...new Set(ok.flatMap((r) => Object.keys(r.sources)))]
  return names
    .map((source) => {
      const shown = ok.filter((r) => r.sources[source]?.shown)
      return {
        source,
        files: shown.length,
        coverage: share(shown.length, ok.length),
        hitWhenShown: share(shown.filter((r) => r.sources[source].hit).length, shown.length),
        firstCorrect: share(shown.filter((r) => r.sources[source].firstHit).length, shown.length),
      }
    })
    .sort((a, b) => b.firstCorrect - a.firstCorrect)
}

export function byKind(results: FileResult[]): Record<string, Summary> {
  const out: Record<string, Summary> = { all: summarize(results) }
  for (const kind of [...KINDS.map((k) => k.kind), 'other'] as Kind[]) {
    const part = results.filter((r) => r.kind === kind)
    if (part.length > 0) out[kind] = summarize(part)
  }
  return out
}
