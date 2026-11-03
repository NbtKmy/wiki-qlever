import type { Candidate } from './candidates'

export function infoErrorStatus(failedCount: number): string {
  return failedCount === 1
    ? 'Could not load the file name of 1 photo. Try again.'
    : `Could not load the file names of ${failedCount} photos. Try again.`
}

export function listStatus(state: 'loading' | { error: string } | Candidate[]): string {
  if (state === 'loading') return 'Loading photos…'
  if (!Array.isArray(state)) return `Could not load photos: ${state.error}. Try again.`
  if (state.length === 0) return 'No photos found in this region.'
  return state.length === 1 ? '1 photo' : `${state.length} photos`
}
