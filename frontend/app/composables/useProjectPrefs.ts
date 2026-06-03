import { ref } from 'vue'

// Per-project shelf state (pinned / hidden), keyed by workflowId and persisted
// to localStorage. Module-scoped refs so every consumer — the home row and the
// All-projects grid — shares one reactive source of truth.
const PIN_KEY = 'comfynext:pinned-projects'
const HIDE_KEY = 'comfynext:hidden-projects'

const pinned = ref<string[]>([])
const hidden = ref<string[]>([])
let initialized = false

function loadOnce() {
  if (import.meta.server || initialized) return
  initialized = true
  try { pinned.value = JSON.parse(localStorage.getItem(PIN_KEY) || '[]') }
  catch { pinned.value = [] }
  try { hidden.value = JSON.parse(localStorage.getItem(HIDE_KEY) || '[]') }
  catch { hidden.value = [] }
}

export function useProjectPrefs() {
  loadOnce()

  function persist() {
    if (import.meta.server) return
    localStorage.setItem(PIN_KEY, JSON.stringify(pinned.value))
    localStorage.setItem(HIDE_KEY, JSON.stringify(hidden.value))
  }

  const isPinned = (id: string) => pinned.value.includes(id)
  const isHidden = (id: string) => hidden.value.includes(id)

  function togglePin(id: string) {
    pinned.value = isPinned(id)
      ? pinned.value.filter((x) => x !== id)
      : [...pinned.value, id]
    persist()
  }

  function hide(id: string) {
    if (!hidden.value.includes(id)) hidden.value = [...hidden.value, id]
    persist()
  }

  function unhide(id: string) {
    hidden.value = hidden.value.filter((x) => x !== id)
    persist()
  }

  return { pinned, hidden, isPinned, isHidden, togglePin, hide, unhide }
}
