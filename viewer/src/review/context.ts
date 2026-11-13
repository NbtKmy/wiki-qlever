// Collects everything known about a batch of files before the per-file search starts.
// Each source may fail on its own; the others are still used.

import { fetchCategoryItems, type CategoryItem } from './categories'
import {
  fetchAddressItems,
  fetchDescriptions,
  fetchStreetItems,
  inNamedTown,
  readDescription,
  streetOf,
  type AddressItem,
} from './description'
import type { GapFile, Selector } from './gaps'
import { loadMemory, recall, type MemoryHit } from './memory'
import { subjectFromFileName, type SearchTerm } from './titleParse'

export type FileContext = {
  categories: CategoryItem[]
  description: string | null
  descriptionTerms: SearchTerm[]
  addressItems: AddressItem[]
  memory: MemoryHit[]
}

export type BatchContext = { files: Map<number, FileContext>; problems: string[] }

export const emptyContext = (): FileContext => ({
  categories: [],
  description: null,
  descriptionTerms: [],
  addressItems: [],
  memory: [],
})

export async function fetchContext(
  files: GapFile[],
  selector: Selector,
  country: string | null,
  signal?: AbortSignal,
): Promise<BatchContext> {
  const pageIds = files.map((f) => f.pageId)
  const [categories, descriptions, memory] = await Promise.allSettled([
    fetchCategoryItems(pageIds, signal),
    fetchDescriptions(pageIds, signal),
    selector.kind === 'collection' ? loadMemory(selector.qid, signal) : Promise.resolve(null),
  ])
  const problems: string[] = []
  if (categories.status === 'rejected') problems.push('Commons categories')
  if (descriptions.status === 'rejected') problems.push('Commons descriptions')
  if (memory.status === 'rejected') problems.push('earlier decisions in the collection')

  const read = new Map<number, ReturnType<typeof readDescription>>()
  for (const file of files) {
    const text = descriptions.status === 'fulfilled' ? descriptions.value.get(file.pageId) : undefined
    if (text) read.set(file.pageId, readDescription(text, subjectFromFileName(file.title)))
  }
  const allAddresses = [...new Set([...read.values()].flatMap((r) => r.addresses))]
  let addressItems: AddressItem[] = []
  try {
    addressItems = await fetchAddressItems(allAddresses, country, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    problems.push('addresses')
  }

  const textOf = (file: GapFile) =>
    `${file.title} ${descriptions.status === 'fulfilled' ? (descriptions.value.get(file.pageId) ?? '') : ''}`
  const buildingsFor = (file: GapFile) =>
    inNamedTown(
      addressItems.filter((a) => read.get(file.pageId)?.addresses.includes(a.address)),
      textOf(file),
    )
  // Streets of the addresses that found no building, one query for the batch.
  const withoutBuilding = files.flatMap((f) =>
    buildingsFor(f).length === 0 ? (read.get(f.pageId)?.addresses ?? []).map((a) => [f.pageId, a] as const) : [],
  )
  let streetItems: AddressItem[] = []
  try {
    streetItems = await fetchStreetItems([...new Set(withoutBuilding.map(([, a]) => streetOf(a)))], country, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    problems.push('streets')
  }

  const out = new Map<number, FileContext>()
  for (const file of files) {
    const fromDescription = read.get(file.pageId)
    const buildings = buildingsFor(file)
    const streets =
      buildings.length > 0
        ? []
        : inNamedTown(
            streetItems.filter((s) => (fromDescription?.addresses ?? []).some((a) => streetOf(a) === s.address)),
            textOf(file),
          )
    out.set(file.pageId, {
      categories: categories.status === 'fulfilled' ? (categories.value.get(file.pageId) ?? []) : [],
      description: descriptions.status === 'fulfilled' ? (descriptions.value.get(file.pageId) ?? null) : null,
      descriptionTerms: fromDescription?.terms ?? [],
      addressItems: [...buildings, ...streets],
      memory: memory.status === 'fulfilled' && memory.value ? recall(memory.value, file.title) : [],
    })
  }
  return { files: out, problems }
}
