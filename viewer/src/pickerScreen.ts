import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchCandidates, type Candidate } from './candidates'
import { fetchFileInfo, type FileInfo } from './commons'
import { REGIONS } from './config'
import { listStatus } from './listStatus'

export type PickedPhoto = Candidate & { title: string }

const INFO_BATCH = 50
const SWISSTOPO_TILES =
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function mountPicker(root: HTMLElement, onPick: (photo: PickedPhoto) => void): () => void {
  const picker = el('div', 'picker')
  const side = el('div', 'picker-list')
  const mapEl = el('div', 'picker-map')
  const header = el('div', 'picker-header')
  const select = el('select')
  for (const region of REGIONS) select.append(new Option(region.label, region.id))
  const shuffle = el('button', undefined, 'Shuffle')
  const status = el('span', 'picker-status')
  const retry = el('button', undefined, 'Retry')
  retry.hidden = true
  const rows = el('ul', 'picker-rows')
  header.append(select, shuffle, status, retry)
  side.append(header, rows)
  picker.append(side, mapEl)
  root.replaceChildren(picker)

  const map = L.map(mapEl)
  L.tileLayer(SWISSTOPO_TILES, { attribution: '© swisstopo', maxZoom: 18 }).addTo(map)
  const dots = L.layerGroup().addTo(map)

  let controller = new AbortController()
  let infos = new Map<number, FileInfo>()
  const rowFor = new Map<number, HTMLLIElement>()

  const pick = (candidate: Candidate) => {
    const info = infos.get(candidate.pageId)
    if (info) onPick({ ...candidate, title: info.title })
  }

  function renderRow(candidate: Candidate) {
    const row = el('li', 'picker-row')
    row.append(el('div', 'picker-thumb'), el('span', 'picker-title', `File info loading… (#${candidate.pageId})`))
    row.onclick = () => pick(candidate)
    rowFor.set(candidate.pageId, row)
    rows.append(row)
  }

  function fillRow(candidate: Candidate, info: FileInfo | undefined) {
    const row = rowFor.get(candidate.pageId)
    if (!row) return
    const title = row.querySelector('.picker-title')!
    const thumb = row.querySelector('.picker-thumb')!
    if (!info) {
      title.textContent = `No file info (#${candidate.pageId})`
      row.classList.add('disabled')
      return
    }
    title.textContent = info.title
    if (info.thumbUrl) {
      const img = el('img')
      img.src = info.thumbUrl
      img.alt = ''
      thumb.replaceChildren(img)
    }
  }

  async function load() {
    controller.abort()
    controller = new AbortController()
    const { signal } = controller
    const region = REGIONS.find((r) => r.id === select.value)!
    rows.replaceChildren()
    rowFor.clear()
    dots.clearLayers()
    infos = new Map()
    retry.hidden = true
    status.textContent = listStatus('loading')
    map.fitBounds([
      [region.bbox.south, region.bbox.west],
      [region.bbox.north, region.bbox.east],
    ])
    let candidates: Candidate[]
    try {
      candidates = await fetchCandidates(region, signal)
    } catch (error) {
      if (signal.aborted) return
      status.textContent = listStatus({ error: error instanceof Error ? error.message : String(error) })
      retry.hidden = false
      return
    }
    if (signal.aborted) return
    status.textContent = listStatus(candidates)
    for (const candidate of candidates) {
      renderRow(candidate)
      L.circleMarker([candidate.subject.lat, candidate.subject.lon], { radius: 5 })
        .on('click', () => {
          rowFor.get(candidate.pageId)?.scrollIntoView({ block: 'center' })
          pick(candidate)
        })
        .addTo(dots)
    }
    for (let i = 0; i < candidates.length; i += INFO_BATCH) {
      const batch = candidates.slice(i, i + INFO_BATCH)
      try {
        const batchInfo = await fetchFileInfo(batch.map((c) => c.pageId))
        if (signal.aborted) return
        for (const c of batch) {
          const info = batchInfo.get(c.pageId)
          if (info) infos.set(c.pageId, info)
          fillRow(c, info)
        }
      } catch {
        if (signal.aborted) return
        for (const c of batch) fillRow(c, undefined)
      }
    }
  }

  select.onchange = load
  shuffle.onclick = load
  retry.onclick = load
  void load()

  return () => {
    controller.abort()
    map.remove()
    root.replaceChildren()
  }
}
