// Runs the benchmark against the live endpoints, with the same code the review page uses.

import {
  buildAnnotatedQuery,
  buildClassQuery,
  evaluate,
  kindOf,
  parseAnnotated,
  parseClasses,
  sample,
  type AnnotatedFile,
  type FileResult,
  type MemoryRow,
} from './benchmark'
import { fetchContext } from './context'
import { buildMemory, recall } from './memory'
import { COMMONS_ENDPOINT, sparql, WIKIDATA_ENDPOINT } from './qlever'
import { parseTitle } from './titleParse'
import { suggest, type Group } from './wikidata'

export type BenchOptions = {
  collection: string
  size: number
  seed: number
  country: string | null
  workers?: number
  /**
   * Hide the Commons categories. 93% of the annotated Zentralbibliothek files have a linked
   * category, against 3 of 20 files still without depicts: without them the benchmark is closer to
   * the files a reviewer will actually see.
   */
  withoutCategories?: boolean
  pauseMs?: number
  onProgress?: (done: number, total: number, last: FileResult) => void
  /** Sees the card of every file, for looking at the misses. */
  onGroups?: (file: AnnotatedFile, groups: Group[]) => void
  signal?: AbortSignal
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Memory without the file under test: built once, then each test file's rows are left out. */
export function leaveOneOut(rows: MemoryRow[], pageId: number) {
  return buildMemory(rows.filter((r) => r.pageId !== pageId).map((r) => [r.title, r.qid] as [string, string]))
}

export async function runBenchmark(options: BenchOptions): Promise<{ results: FileResult[]; population: number }> {
  const { collection, size, seed, country, signal } = options
  const { files, rows } = parseAnnotated(await sparql(COMMONS_ENDPOINT, buildAnnotatedQuery(collection), signal, 90_000))
  const picked: AnnotatedFile[] = sample(files, size, seed)

  const goldItems = [...new Set(picked.flatMap((f) => [...f.gold]))]
  const classes = new Map<string, Set<string>>()
  for (let i = 0; i < goldItems.length; i += 150) {
    for (const [k, v] of parseClasses(await sparql(WIKIDATA_ENDPOINT, buildClassQuery(goldItems.slice(i, i + 150)), signal, 60_000))) {
      classes.set(k, v)
    }
  }

  // Context per batch of 20, as the review page does. Memory is added per file, leave-one-out.
  const contexts = new Map<number, Awaited<ReturnType<typeof fetchContext>>['files'] extends Map<number, infer C> ? C : never>()
  for (let i = 0; i < picked.length; i += 20) {
    const batch = picked.slice(i, i + 20)
    const ctx = await fetchContext(batch, { kind: 'category', title: 'unused' }, country, signal)
    for (const [k, v] of ctx.files) contexts.set(k, v)
  }

  const results: FileResult[] = []
  let next = 0
  const worker = async () => {
    while (next < picked.length && !signal?.aborted) {
      const file = picked[next++]
      const kind = kindOf(file.gold, classes)
      let result: FileResult
      try {
        const context = {
          ...contexts.get(file.pageId)!,
          ...(options.withoutCategories ? { categories: [] } : {}),
          memory: recall(leaveOneOut(rows, file.pageId), file.title),
        }
        const groups = await suggest(parseTitle(file.title).terms, context, country, signal)
        options.onGroups?.(file, groups)
        result = evaluate(file, kind, groups)
      } catch (error) {
        result = { ...evaluate(file, kind, []), error: error instanceof Error ? error.message : String(error) }
      }
      results.push(result)
      options.onProgress?.(results.length, picked.length, result)
      await pause(options.pauseMs ?? 300)
    }
  }
  await Promise.all(Array.from({ length: options.workers ?? 2 }, worker))
  return { results, population: files.length }
}
