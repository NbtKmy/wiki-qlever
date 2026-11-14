// Files of one series: the same caption with another number ("Bern, Kornhaus - … - GS-GUGE-12-1" and
// "… - GS-GUGE-12-2", "Persien, Isfahan- Menschen - … -177" and "…-178"). What a reviewer accepts on one
// of them is offered on the others, one click each: the reviewer still looks at every photo.

import { subjectFromFileName } from './titleParse'

/** The caption without numbers, case and punctuation; empty when too little is left to compare. */
export function seriesKey(fileName: string): string {
  const key = subjectFromFileName(fileName)
    .toLowerCase()
    .replace(/[\d_]+/g, ' ')
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
  return key.replace(/\s/g, '').length >= 4 ? key : ''
}

export type SeriesOffer = { qid: string; label: string; from: string }

/**
 * Items accepted on other files of the same series, once each, in the order they were accepted.
 * `files` are the loaded files with their key; `acceptedOf` reads the decisions.
 */
export function seriesOffers(
  pageId: number,
  key: string,
  files: { pageId: number; title: string; key: string }[],
  acceptedOf: (pageId: number) => { qid: string; label: string }[],
): { siblings: number; offers: SeriesOffer[] } {
  if (!key) return { siblings: 0, offers: [] }
  const siblings = files.filter((f) => f.key === key && f.pageId !== pageId)
  const offers: SeriesOffer[] = []
  for (const sibling of siblings) {
    for (const a of acceptedOf(sibling.pageId)) {
      if (!offers.some((o) => o.qid === a.qid)) offers.push({ qid: a.qid, label: a.label, from: sibling.title })
    }
  }
  return { siblings: siblings.length, offers }
}
