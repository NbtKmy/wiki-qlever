// The review page: one card per file without a depicts statement. The reviewer ticks the Wikidata
// items the photo shows; nothing is pre-selected and nothing is written to Commons.

import { summarize, toQuickStatements, toReviewLog, type DecisionStore } from './decisions'
import {
  describeSelector,
  fetchGapBatch,
  firstCursor,
  isQid,
  PRESETS,
  type Cursor,
  type GapFile,
  type Selector,
} from './gaps'
import { emptyContext, fetchContext, type FileContext } from './context'
import { checkItems, describeCheck } from './verify'
import { parseTitle, type ParsedTitle } from './titleParse'
import { CONSENSUS_TITLE, suggest, SWITZERLAND, wikidataUrl, type Candidate, type Group } from './wikidata'

const LOOKUP_PAUSE_MS = 300
const LOOKUP_WORKERS = 2
const COMPASS_NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function link(href: string, text: string) {
  const a = el('a', undefined, text)
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener'
  return a
}

function option(text: string, value: string) {
  const node = el('option', undefined, text)
  node.value = value
  return node
}

const underscored = (title: string) => encodeURIComponent(title.replace(/ /g, '_'))
const commonsPageUrl = (title: string) => `https://commons.wikimedia.org/wiki/File:${underscored(title)}`
const commonsThumbUrl = (title: string, width: number) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${underscored(title)}?width=${width}`

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
  })

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export type ReviewOptions = {
  store: DecisionStore
  /** Replaced in tests. */
  lookup?: typeof suggest
  fetchBatch?: typeof fetchGapBatch
  fetchContext?: typeof fetchContext
  checkItems?: typeof checkItems
  lookupPauseMs?: number
}

export function mountReview(root: HTMLElement, options: ReviewOptions): () => void {
  const { store } = options
  const lookup = options.lookup ?? suggest
  const loadContext = options.fetchContext ?? fetchContext
  const fetchBatch = options.fetchBatch ?? fetchGapBatch
  const lookupPauseMs = options.lookupPauseMs ?? LOOKUP_PAUSE_MS

  // ---- header -------------------------------------------------------------------------------
  const page = el('div', 'review')
  const header = el('header', 'review-header')
  header.append(
    el('h1', undefined, 'Depicts review'),
    el(
      'p',
      'review-intro',
      'Files without a depicts (P180) statement, with Wikidata candidates from their Commons categories, ' +
        'their file name and description, and from what other files of the collection depict. ' +
        'Tick what the photo really shows. Nothing is selected for you and nothing is written to Commons: ' +
        'you export the accepted statements for QuickStatements.',
    ),
  )

  const controls = el('div', 'review-controls')
  const source = el('select')
  source.ariaLabel = 'Collection'
  for (const preset of PRESETS) source.append(option(preset.label, preset.id))
  source.append(
    option('Other collection (P195 item ID)…', 'collection'),
    option('Other file-name prefix…', 'prefix'),
    option('Commons category…', 'category'),
    option('Commons search…', 'search'),
  )
  const custom = el('input')
  custom.type = 'text'
  custom.hidden = true
  custom.ariaLabel = 'Collection value'
  const batch = el('select')
  batch.ariaLabel = 'Files per batch'
  for (const n of [10, 20, 50]) batch.append(option(`${n} files`, String(n)))
  batch.value = '20'
  const countryLabel = el('label', 'review-country', 'Prefer places in ')
  const country = el('input')
  country.type = 'text'
  country.value = SWITZERLAND
  country.size = 6
  country.title = 'Wikidata item of a country (Q39 is Switzerland). Leave empty for no preference.'
  countryLabel.append(country)
  const loadButton = el('button', 'primary', 'Load files')
  const moreButton = el('button', undefined, 'Next batch')
  moreButton.hidden = true
  const status = el('span', 'review-status')
  status.role = 'status'
  controls.append(source, custom, batch, countryLabel, loadButton, moreButton, status)

  const exportBar = el('div', 'review-export')
  const tally = el('span', 'review-tally')
  const copyButton = el('button', undefined, 'Copy QuickStatements')
  const logButton = el('button', undefined, 'Download review log (JSON)')
  const clearButton = el('button', 'quiet', 'Clear all decisions')
  const exportNote = el('span', 'review-status')
  exportBar.append(tally, copyButton, logButton, clearButton, exportNote)
  const exportText = el('textarea', 'review-export-text')
  exportText.readOnly = true
  exportText.rows = 4
  exportText.hidden = true
  exportText.ariaLabel = 'QuickStatements commands'

  const cards = el('div', 'review-cards')
  header.append(controls, exportBar, exportText)
  page.append(header, cards)
  root.replaceChildren(page)

  // ---- state --------------------------------------------------------------------------------
  let controller = new AbortController()
  let selector: Selector | null = null
  let cursor: Cursor = firstCursor()
  let shown = 0
  let busy = false

  const customPlaceholder: Record<string, string> = {
    collection: 'e.g. Q190260',
    prefix: 'e.g. ETH-BIB-',
    category: 'e.g. Collection of Museum Rietberg, Zürich',
    search: 'e.g. incategory:"Media contributed by the ETH-Bibliothek" Säntis',
  }

  function readSelector(): Selector {
    const preset = PRESETS.find((p) => p.id === source.value)
    if (preset) return preset.selector
    const value = custom.value.trim()
    if (!value) throw new Error('Enter a value for the collection first')
    if (source.value === 'collection') {
      if (!isQid(value)) throw new Error(`"${value}" is not a Wikidata item ID such as Q190260`)
      return { kind: 'collection', qid: value }
    }
    if (source.value === 'search') return { kind: 'search', query: value }
    return source.value === 'prefix' ? { kind: 'prefix', prefix: value } : { kind: 'category', title: value }
  }

  const preferredCountry = () => {
    const value = country.value.trim()
    return isQid(value) ? value : null
  }

  // ---- cards --------------------------------------------------------------------------------
  function candidateRow(file: GapFile, parsed: ParsedTitle, group: Group, candidate: Candidate) {
    const row = el('label', 'candidate')
    const box = el('input')
    box.type = 'checkbox'
    box.dataset.qid = candidate.qid
    box.checked = store.get(file.pageId)?.accepted.some((a) => a.qid === candidate.qid) ?? false
    box.onchange = () => {
      if (box.checked) {
        store.accept(file, parsed.heading, {
          qid: candidate.qid,
          label: candidate.label,
          term: group.title,
          source: candidate.origin,
          score: candidate.score,
          reasons: candidate.reasons,
        })
      } else {
        store.withdraw(file.pageId, candidate.qid)
      }
    }
    const text = el('span', 'candidate-text')
    const name = el('span', 'candidate-name')
    name.append(el('strong', undefined, candidate.label), ' ', link(wikidataUrl(candidate.qid), candidate.qid))
    text.append(name)
    if (candidate.description) text.append(el('span', 'candidate-desc', candidate.description))
    const facts = [candidate.typeLabels.slice(0, 3).join(', '), ...candidate.reasons].filter(Boolean)
    text.append(el('span', 'candidate-why', facts.join(' · ')))
    row.append(box, text)
    if (group.title.startsWith('“')) {
      // Only for search terms: a rejection is remembered for the term that produced the candidate.
      const term = group.title.slice(1, -1)
      const isRejected = () =>
        store.get(file.pageId)?.rejectedItems?.some((r) => r.qid === candidate.qid && r.term === term) ?? false
      const not = el('button', 'candidate-reject', isRejected() ? 'undo' : '✕ not this')
      not.type = 'button'
      not.title = `Remember that “${term}” does not mean this item; it will rank last for this term on other files`
      not.onclick = (event) => {
        event.preventDefault()
        if (isRejected()) store.unrejectItem(file.pageId, candidate.qid, term)
        else store.rejectItem(file, parsed.heading, candidate.qid, term)
        const now = isRejected()
        not.textContent = now ? 'undo' : '✕ not this'
        row.classList.toggle('rejected-candidate', now)
      }
      row.classList.toggle('rejected-candidate', isRejected())
      row.append(not)
    }
    return row
  }

  function renderResults(host: HTMLElement, file: GapFile, parsed: ParsedTitle, groups: Group[]) {
    host.replaceChildren()
    for (const group of groups) {
      const section = el('div', group.title === CONSENSUS_TITLE ? 'term term-consensus' : 'term')
      const head = el('div', 'term-head')
      head.append(el('span', 'term-text', group.title), el('span', 'term-source', group.source))
      if (group.measured) head.append(el('span', 'term-measured', group.measured))
      section.append(head)
      if (group.caution) section.append(el('div', 'term-caution', group.caution))
      if (group.candidates.length === 0) section.append(el('div', 'term-empty', 'Nothing found on Wikidata.'))
      for (const candidate of group.candidates) section.append(candidateRow(file, parsed, group, candidate))
      host.append(section)
    }
  }

  function renderCard(file: GapFile, context: FileContext) {
    const parsed = parseTitle(file.title)
    const card = el('article', 'card')
    const figure = el('a', 'card-thumb')
    figure.href = commonsPageUrl(file.title)
    figure.target = '_blank'
    figure.rel = 'noopener'
    const img = el('img')
    img.loading = 'lazy'
    img.alt = ''
    img.src = commonsThumbUrl(file.title, 480)
    figure.append(img)

    const body = el('div', 'card-body')
    const title = el('h2', 'card-title')
    title.append(link(commonsPageUrl(file.title), file.title))
    body.append(title)
    if (context.description) body.append(el('p', 'card-desc', context.description))
    if (parsed.heading) {
      const name = COMPASS_NAMES[Math.round(parsed.heading.headingDeg / 45) % 8]
      body.append(
        el(
          'div',
          'card-heading',
          `Direction hint: “${parsed.heading.phrase}” reads as ${parsed.heading.reading} that direction, ` +
            `so the camera looks roughly ${name} (${parsed.heading.headingDeg}°). Kept in the review log only.`,
        ),
      )
    }

    const results = el('div', 'card-results')
    const retry = el('button', undefined, 'Retry lookup')
    retry.hidden = true
    body.append(results, retry)

    // Manual entry and "nothing fits".
    const manual = el('div', 'card-manual')
    const manualInput = el('input')
    manualInput.type = 'text'
    manualInput.placeholder = 'Other item, e.g. Q16525'
    manualInput.size = 22
    manualInput.ariaLabel = 'Other Wikidata item ID'
    const manualAdd = el('button', undefined, 'Add')
    const manualList = el('span', 'card-manual-list')
    const nothing = el('label', 'card-nothing')
    const nothingBox = el('input')
    nothingBox.type = 'checkbox'
    nothing.append(nothingBox, ' Nothing fits')
    manual.append(manualInput, manualAdd, manualList, nothing)
    body.append(manual)

    const addManual = () => {
      const qid = manualInput.value.trim().toUpperCase()
      if (!isQid(qid)) {
        manualInput.setCustomValidity('Enter an item ID such as Q16525')
        manualInput.reportValidity()
        return
      }
      manualInput.setCustomValidity('')
      store.accept(file, parsed.heading, {
        qid,
        label: qid,
        term: 'manual',
        source: 'typed by the reviewer',
        score: null,
        reasons: [],
      })
      manualInput.value = ''
    }
    manualAdd.onclick = addManual
    manualInput.onkeydown = (event) => {
      if (event.key === 'Enter') addManual()
    }
    manualInput.oninput = () => manualInput.setCustomValidity('')
    nothingBox.onchange = () => store.setRejected(file, parsed.heading, nothingBox.checked)

    const sync = () => {
      const decision = store.get(file.pageId)
      const accepted = decision?.accepted ?? []
      card.classList.toggle('accepted', accepted.length > 0)
      card.classList.toggle('rejected', decision?.rejected ?? false)
      nothingBox.checked = decision?.rejected ?? false
      results.querySelectorAll<HTMLInputElement>('input[data-qid]').forEach((box) => {
        box.checked = accepted.some((a) => a.qid === box.dataset.qid)
      })
      manualList.replaceChildren(
        ...accepted
          .filter((a) => a.term === 'manual')
          .map((a) => {
            const chip = el('span', 'chip')
            const remove = el('button', 'chip-remove', '×')
            remove.ariaLabel = `Remove ${a.qid}`
            remove.onclick = () => store.withdraw(file.pageId, a.qid)
            chip.append(link(wikidataUrl(a.qid), a.qid), remove)
            return chip
          }),
      )
    }

    async function runLookup(signal: AbortSignal): Promise<boolean> {
      retry.hidden = true
      const nothing =
        parsed.terms.length === 0 &&
        context.categories.length === 0 &&
        context.descriptionTerms.length === 0 &&
        context.addressItems.length === 0 &&
        context.memory.length === 0
      if (nothing) {
        results.replaceChildren(el('div', 'term-empty', 'No search term could be read from this file name.'))
        return true
      }
      results.replaceChildren(el('div', 'term-empty', 'Looking up candidates…'))
      try {
        const found = await lookup(parsed.terms, context, preferredCountry(), signal, store.rejectionsByTerm())
        if (signal.aborted) return false
        renderResults(results, file, parsed, found)
        sync()
        return true
      } catch (error) {
        if (signal.aborted) return false
        results.replaceChildren(el('div', 'term-error', `Lookup failed: ${errorText(error)}.`))
        retry.hidden = false
        return false
      }
    }
    retry.onclick = () => void runLookup(controller.signal)

    card.append(figure, body)
    cards.append(card)
    const unsubscribe = store.subscribe(sync)
    sync()
    return { runLookup, unsubscribe }
  }

  let unsubscribers: (() => void)[] = []

  // ---- loading ------------------------------------------------------------------------------
  async function loadBatch(reset: boolean) {
    if (busy && !reset) return
    if (reset) {
      controller.abort()
      controller = new AbortController()
      try {
        selector = readSelector()
      } catch (error) {
        status.textContent = errorText(error)
        return
      }
      cursor = firstCursor()
      shown = 0
      unsubscribers.forEach((fn) => fn())
      unsubscribers = []
      cards.replaceChildren()
    }
    if (!selector) return
    const { signal } = controller
    busy = true
    moreButton.hidden = true
    status.textContent = `Asking QLever for files without depicts (${describeSelector(selector)})…`
    let files: GapFile[]
    try {
      const result = await fetchBatch(selector, Number(batch.value), cursor, signal)
      if (signal.aborted) return
      cursor = result.cursor
      files = result.files
    } catch (error) {
      if (signal.aborted) return
      busy = false
      status.textContent = `Could not load files: ${errorText(error)}.`
      moreButton.textContent = 'Retry'
      moreButton.hidden = false
      return
    }
    moreButton.textContent = 'Next batch'
    shown += files.length
    status.textContent = 'Reading categories, descriptions and earlier decisions…'
    let contexts = new Map<number, FileContext>()
    let problems: string[] = []
    try {
      const batchContext = await loadContext(files, selector, preferredCountry(), signal)
      contexts = batchContext.files
      problems = batchContext.problems
    } catch {
      // The file-name search still works without any of them.
      problems = ['categories, descriptions and earlier decisions']
    }
    if (signal.aborted) return
    const lookups = files.map((file) => {
      const card = renderCard(file, contexts.get(file.pageId) ?? emptyContext())
      unsubscribers.push(card.unsubscribe)
      return card.runLookup
    })
    // Two files at a time, each worker pausing between files: more trips the endpoints' rate limits.
    let failed = 0
    let next = 0
    let done = 0
    const worker = async () => {
      while (next < lookups.length && !signal.aborted) {
        const lookup = lookups[next++]
        const ok = await lookup(signal)
        if (signal.aborted) return
        if (!ok) failed++
        done++
        status.textContent = `Looking up candidates: ${done} of ${lookups.length}…`
        if (next < lookups.length) await pause(lookupPauseMs, signal)
      }
    }
    status.textContent = `Looking up candidates: 0 of ${lookups.length}…`
    await Promise.all(Array.from({ length: Math.min(LOOKUP_WORKERS, lookups.length) }, worker))
    if (signal.aborted) return
    busy = false
    const count = shown === 1 ? '1 file' : `${shown} files`
    status.textContent =
      shown === 0 && cursor.done
        ? 'No files without depicts found for this selection.'
        : `${count} without depicts shown${cursor.done ? ' (end of the collection)' : ''}` +
          (failed > 0 ? `. ${failed} lookup${failed === 1 ? '' : 's'} failed: use Retry on the card.` : '.') +
          (problems.length > 0 ? ` Could not read: ${problems.join(', ')}.` : '')
    moreButton.hidden = cursor.done
  }

  // ---- export -------------------------------------------------------------------------------
  function renderTally() {
    const { files, statements, rejected } = summarize(store.all())
    tally.textContent =
      `${statements} statement${statements === 1 ? '' : 's'} accepted on ${files} file${files === 1 ? '' : 's'}` +
      (rejected > 0 ? `, ${rejected} marked “nothing fits”` : '')
    copyButton.disabled = statements === 0
    logButton.disabled = statements === 0 && rejected === 0
    clearButton.disabled = statements === 0 && rejected === 0
    exportText.value = toQuickStatements(store.all())
    if (statements === 0) exportText.hidden = true
  }

  copyButton.onclick = async () => {
    exportText.hidden = false
    // The clipboard needs the click's user activation: copy first, then check on Wikidata.
    exportText.value = toQuickStatements(store.all())
    let copied = true
    try {
      await navigator.clipboard.writeText(exportText.value)
    } catch {
      copied = false
    }
    exportNote.textContent = 'Checking the items on Wikidata…'
    let checkNote = ''
    try {
      const qids = store.all().flatMap((d) => d.accepted.map((a) => a.qid))
      const check = await (options.checkItems ?? checkItems)(qids)
      checkNote = describeCheck(check)
      if (checkNote) {
        exportText.value = toQuickStatements(store.all(), check)
        copied = false
      }
    } catch {
      checkNote = 'Could not check the items on Wikidata; merged or deleted items may be in the list'
    }
    if (!copied) exportText.select()
    exportNote.textContent =
      (checkNote ? `${checkNote}. ` : '') +
      (copied
        ? 'Copied. Paste into QuickStatements in Commons mode and check the preview there.'
        : 'Copy the commands from the box below, then paste them into QuickStatements in Commons mode.')
  }
  logButton.onclick = () => {
    const blob = new Blob([toReviewLog(store.all(), selector ? describeSelector(selector) : 'not set')], {
      type: 'application/json',
    })
    const a = el('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'depicts-review-log.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  let clearArmed = false
  clearButton.onclick = () => {
    if (!clearArmed) {
      clearArmed = true
      clearButton.textContent = 'Click again to clear'
      setTimeout(() => {
        clearArmed = false
        clearButton.textContent = 'Clear all decisions'
      }, 4000)
      return
    }
    clearArmed = false
    clearButton.textContent = 'Clear all decisions'
    store.clear()
    exportNote.textContent = ''
  }

  source.onchange = () => {
    const isCustom = !PRESETS.some((p) => p.id === source.value)
    custom.hidden = !isCustom
    custom.placeholder = customPlaceholder[source.value] ?? ''
    if (isCustom) custom.focus()
  }
  custom.onkeydown = (event) => {
    if (event.key === 'Enter') void loadBatch(true)
  }
  loadButton.onclick = () => void loadBatch(true)
  moreButton.onclick = () => void loadBatch(false)

  const stopTally = store.subscribe(renderTally)
  renderTally()

  return () => {
    controller.abort()
    stopTally()
    unsubscribers.forEach((fn) => fn())
    root.replaceChildren()
  }
}
