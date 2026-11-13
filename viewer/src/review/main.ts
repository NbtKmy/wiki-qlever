import './review.css'
import { createDecisionStore, type KeyValueStore } from './decisions'
import { mountReview } from './reviewScreen'

// Some browsers throw on any access to localStorage (blocked cookies, some file:// setups).
let storage: KeyValueStore | null = null
try {
  storage = window.localStorage
} catch {
  storage = null
}

mountReview(document.getElementById('app')!, { store: createDecisionStore(storage) })
