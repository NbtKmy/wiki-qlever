export type FileInfo = { title: string; thumbUrl: string | null }

const API = 'https://commons.wikimedia.org/w/api.php'
const BATCH_SIZE = 50

export function buildFileInfoUrl(pageIds: number[], thumbWidth: number): string {
  const params = new URLSearchParams({
    action: 'query',
    pageids: pageIds.join('|'),
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: String(thumbWidth),
    format: 'json',
    origin: '*',
  })
  return `${API}?${params}`
}

type Page = { pageid?: number; title?: string; imageinfo?: { thumburl?: string }[] }

export function parseFileInfo(json: unknown): Map<number, FileInfo> {
  const pages = (json as { query?: { pages?: Record<string, Page> } }).query?.pages ?? {}
  const result = new Map<number, FileInfo>()
  for (const page of Object.values(pages)) {
    if (page.pageid === undefined || page.title === undefined) continue
    result.set(page.pageid, {
      title: page.title.replace(/^File:/, ''),
      thumbUrl: page.imageinfo?.[0]?.thumburl ?? null,
    })
  }
  return result
}

export async function fetchFileInfo(pageIds: number[]): Promise<Map<number, FileInfo>> {
  const result = new Map<number, FileInfo>()
  for (let i = 0; i < pageIds.length; i += BATCH_SIZE) {
    const response = await fetch(buildFileInfoUrl(pageIds.slice(i, i + BATCH_SIZE), 120))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    for (const [id, info] of parseFileInfo(await response.json())) result.set(id, info)
  }
  return result
}

const underscored = (title: string) => encodeURIComponent(title.replace(/ /g, '_'))

export const commonsPageUrl = (title: string): string =>
  `https://commons.wikimedia.org/wiki/File:${underscored(title)}`

export const commonsImageUrl = (title: string, width: number): string =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${underscored(title)}?width=${width}`
