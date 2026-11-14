// Step 4 and 5 of the pipeline: keep the reviewer's decisions and export the accepted statements.
// Nothing is written to Commons from here. The reviewer pastes the export into QuickStatements.

import type { HeadingHint } from './titleParse'

export type AcceptedValue = {
  qid: string
  label: string
  /** Search term that produced the candidate, or "manual" for an ID typed by the reviewer. */
  term: string
  source: string
  score: number | null
  reasons: string[]
}

export type Decision = {
  pageId: number
  title: string
  accepted: AcceptedValue[]
  /** The reviewer looked at the file and found no fitting candidate. */
  rejected: boolean
  /** Candidates the reviewer marked "not this", with the search term that produced them. */
  rejectedItems?: { qid: string; term: string }[]
  heading: HeadingHint | null
  decidedAt: string
}

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

const STORAGE_KEY = 'wiki-qlever.depicts-review.v1'

export function createDecisionStore(storage: KeyValueStore | null, now: () => Date = () => new Date()) {
  const decisions = new Map<number, Decision>()
  const subscribers = new Set<() => void>()

  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]') as Decision[]
    for (const d of saved) if (typeof d.pageId === 'number' && Array.isArray(d.accepted)) decisions.set(d.pageId, d)
  } catch {
    // Unreadable or blocked storage: start empty.
  }

  function changed() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify([...decisions.values()]))
    } catch {
      // Storage full or blocked: the decisions stay in memory for this visit.
    }
    subscribers.forEach((fn) => fn())
  }

  function entry(file: { pageId: number; title: string }, heading: HeadingHint | null): Decision {
    let decision = decisions.get(file.pageId)
    if (!decision) {
      decision = { ...file, accepted: [], rejected: false, heading, decidedAt: '' }
      decisions.set(file.pageId, decision)
    }
    decision.decidedAt = now().toISOString()
    return decision
  }

  return {
    get: (pageId: number): Decision | undefined => decisions.get(pageId),
    all: (): Decision[] => [...decisions.values()],
    accept(file: { pageId: number; title: string }, heading: HeadingHint | null, value: AcceptedValue) {
      const decision = entry(file, heading)
      decision.rejected = false
      if (!decision.accepted.some((a) => a.qid === value.qid)) decision.accepted.push(value)
      changed()
    },
    withdraw(pageId: number, qid: string) {
      const decision = decisions.get(pageId)
      if (!decision) return
      decision.accepted = decision.accepted.filter((a) => a.qid !== qid)
      if (isEmpty(decision)) decisions.delete(pageId)
      changed()
    },
    setRejected(file: { pageId: number; title: string }, heading: HeadingHint | null, rejected: boolean) {
      const decision = entry(file, heading)
      decision.rejected = rejected
      if (rejected) decision.accepted = []
      else if (isEmpty(decision)) decisions.delete(file.pageId)
      changed()
    },
    /** "Not this": remembered for this term, so the item ranks last when the term comes up again. */
    rejectItem(file: { pageId: number; title: string }, heading: HeadingHint | null, qid: string, term: string) {
      const decision = entry(file, heading)
      decision.accepted = decision.accepted.filter((a) => a.qid !== qid)
      const list = (decision.rejectedItems ??= [])
      if (!list.some((r) => r.qid === qid && r.term === term)) list.push({ qid, term })
      changed()
    },
    unrejectItem(pageId: number, qid: string, term: string) {
      const decision = decisions.get(pageId)
      if (!decision?.rejectedItems) return
      decision.rejectedItems = decision.rejectedItems.filter((r) => !(r.qid === qid && r.term === term))
      if (isEmpty(decision)) decisions.delete(pageId)
      changed()
    },
    /** Rejected items per search term, over all files: lower-cased term → item IDs. */
    rejectionsByTerm(): Map<string, Set<string>> {
      const out = new Map<string, Set<string>>()
      for (const d of decisions.values()) {
        for (const r of d.rejectedItems ?? []) {
          const key = r.term.toLowerCase()
          out.set(key, (out.get(key) ?? new Set()).add(r.qid))
        }
      }
      return out
    },
    clear() {
      decisions.clear()
      changed()
    },
    subscribe(fn: () => void): () => void {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
  }
}

const isEmpty = (d: Decision) => d.accepted.length === 0 && !d.rejected && (d.rejectedItems?.length ?? 0) === 0

export type DecisionStore = ReturnType<typeof createDecisionStore>

export function summarize(decisions: Decision[]): { files: number; statements: number; rejected: number } {
  const withValues = decisions.filter((d) => d.accepted.length > 0)
  return {
    files: withValues.length,
    statements: withValues.reduce((n, d) => n + d.accepted.length, 0),
    rejected: decisions.filter((d) => d.rejected).length,
  }
}

/**
 * QuickStatements V1 commands for Commons: one "M<page id>|P180|Q<item>" line per accepted value.
 * With a live check, merged items become their target and deleted items are left out.
 */
export function toQuickStatements(
  decisions: Decision[],
  check: { redirects: Map<string, string>; missing: Set<string> } = { redirects: new Map(), missing: new Set() },
): string {
  const lines = decisions.flatMap((d) =>
    d.accepted
      .filter((a) => !check.missing.has(a.qid))
      .map((a) => `M${d.pageId}|P180|${check.redirects.get(a.qid) ?? a.qid}`),
  )
  return [...new Set(lines)].join('\n')
}

/** The full record: what was suggested from where, what the reviewer chose, and the heading hints. */
export function toReviewLog(decisions: Decision[], collection: string): string {
  return JSON.stringify(
    {
      tool: 'wiki-qlever depicts review',
      property: 'P180',
      collection,
      note: 'Heading hints are read from file names and are not part of the QuickStatements export.',
      decisions,
    },
    null,
    2,
  )
}
