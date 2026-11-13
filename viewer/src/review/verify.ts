// Checks the accepted items on the live Wikidata before export. QLever is a copy that can be days
// behind: an item may have been merged (redirect) or deleted since. Redirects are replaced by their
// target; deleted items are left out and reported.

export type ItemCheck = { redirects: Map<string, string>; missing: Set<string> }

const API = 'https://www.wikidata.org/w/api.php'

export function buildCheckUrl(qids: string[]): string {
  return `${API}?${new URLSearchParams({
    action: 'wbgetentities',
    ids: qids.join('|'),
    props: 'info',
    redirects: 'yes',
    format: 'json',
    origin: '*',
  })}`
}

type EntitiesJson = {
  entities?: Record<string, { id?: string; missing?: string; redirects?: { from?: string; to?: string } }>
}

export function parseCheck(json: unknown): ItemCheck {
  const redirects = new Map<string, string>()
  const missing = new Set<string>()
  for (const [key, entity] of Object.entries((json as EntitiesJson).entities ?? {})) {
    if (entity.missing !== undefined) missing.add(entity.id ?? key)
    else if (entity.redirects?.from && entity.redirects.to) redirects.set(entity.redirects.from, entity.redirects.to)
  }
  return { redirects, missing }
}

/** 50 IDs per request, the API's limit for anonymous users. */
export async function checkItems(qids: string[], signal?: AbortSignal): Promise<ItemCheck> {
  const out: ItemCheck = { redirects: new Map(), missing: new Set() }
  const unique = [...new Set(qids)]
  for (let i = 0; i < unique.length; i += 50) {
    const response = await fetch(buildCheckUrl(unique.slice(i, i + 50)), { signal })
    if (!response.ok) throw new Error(`Wikidata API: HTTP ${response.status}`)
    const part = parseCheck(await response.json())
    part.redirects.forEach((to, from) => out.redirects.set(from, to))
    part.missing.forEach((q) => out.missing.add(q))
  }
  return out
}

/** What to tell the reviewer after the check. Empty when everything was current. */
export function describeCheck(check: ItemCheck): string {
  const parts: string[] = []
  if (check.redirects.size > 0) {
    parts.push(`${[...check.redirects].map(([a, b]) => `${a} → ${b}`).join(', ')} merged on Wikidata: the target is exported`)
  }
  if (check.missing.size > 0) parts.push(`${[...check.missing].join(', ')} deleted on Wikidata: left out`)
  return parts.join('. ')
}
