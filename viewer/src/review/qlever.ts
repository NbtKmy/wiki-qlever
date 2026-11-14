// Minimal SPARQL client for the QLever endpoints (see docs/qlever-basics.md for the pitfalls handled here).

export const COMMONS_ENDPOINT = 'https://qlever.dev/api/wikimedia-commons'
export const WIKIDATA_ENDPOINT = 'https://qlever.dev/api/wikidata'

const GET_LIMIT = 1800
const DEFAULT_TIMEOUT_MS = 45_000

export type Binding = Record<string, { value: string; 'xml:lang'?: string } | undefined>

export class SparqlError extends Error {
  status: number
  retryAfter: number | null
  constructor(status: number, message: string, retryAfter: number | null = null) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
  }
}

export function describeStatus(status: number): string {
  if (status === 429) return 'the endpoint is still rate limiting us after several attempts (HTTP 429). Wait a minute, then retry'
  if (status === 504) return 'the query timed out at the gateway (HTTP 504). Try a smaller batch'
  return `HTTP ${status}`
}

/** The endpoint sometimes sends the JSON document twice. Parse only the first one. */
export function parseFirstJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
      } else if (ch === '"') inString = true
      else if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) return JSON.parse(text.slice(0, i + 1))
      }
    }
    throw error
  }
}

export function bindingsOf(json: unknown): Binding[] {
  return (json as { results?: { bindings?: Binding[] } } | null)?.results?.bindings ?? []
}

export const literal = (text: string, lang: string): string =>
  `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\t]/g, ' ')}"@${lang}`

/** Rate limit, and the gateway errors the benchmark met (8 of 150 files failed with HTTP 502). */
const RETRY_STATUS = new Set([429, 502, 503])

/** Waits before each new attempt. Replaced in tests. */
export const retryPolicy = { delaysMs: [3_000, 8_000, 20_000] }

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true })
  })

/** Seconds from a Retry-After header, if the endpoint sends one. */
export function retryAfterMs(header: string | null): number | null {
  const seconds = header ? Number(header) : NaN
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) * 1000 : null
}

/**
 * Runs a query and, when the endpoint answers HTTP 429, waits and tries again a few times
 * (the first live runs hit the limit after a few hundred queries in some minutes).
 */
export async function sparql(
  endpoint: string,
  query: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Binding[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sparqlOnce(endpoint, query, signal, timeoutMs)
    } catch (error) {
      const delay = retryPolicy.delaysMs[attempt]
      if (!(error instanceof SparqlError) || !RETRY_STATUS.has(error.status) || delay === undefined) throw error
      await wait(error.retryAfter ?? delay, signal)
    }
  }
}

async function sparqlOnce(
  endpoint: string,
  query: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Binding[]> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const params = new URLSearchParams({ query })
  const headers = { Accept: 'application/sparql-results+json' }
  // Short queries use GET like the camera viewer does; long VALUES lists need POST.
  const short = params.toString().length <= GET_LIMIT
  let response: Response
  try {
    response = short
      ? await fetch(`${endpoint}?${params}`, { headers, signal: combined })
      : await fetch(endpoint, { method: 'POST', body: params, headers, signal: combined })
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw new SparqlError(0, `no answer after ${timeoutMs / 1000} s`)
    throw error
  }
  if (!response.ok) {
    throw new SparqlError(response.status, describeStatus(response.status), retryAfterMs(response.headers.get('Retry-After')))
  }
  return bindingsOf(parseFirstJson(await response.text()))
}
