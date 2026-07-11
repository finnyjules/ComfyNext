import { ref, computed } from 'vue'

// Asset cards in the AssetsPanel are rebuilt from disk + history cache on
// every open, so "removing" a card has to survive a re-scan. We keep a
// stable set of asset keys in localStorage and filter the visible list
// against it. One key per (type, subfolder, filename) — promptId is
// intentionally NOT in the key so a deleted file's repeat history entries
// stay hidden too.

const STORAGE_KEY = 'sailor:hidden-assets'

function loadHidden(): Set<string> {
  if (import.meta.server) return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  }
  catch {
    return new Set()
  }
}

const hidden = ref<Set<string>>(loadHidden())

function persist() {
  if (import.meta.server) return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden.value])) }
  catch { /* quota / private mode — accept the loss */ }
}

export function assetKey(a: { type?: string; subfolder?: string; filename: string }): string {
  return `${a.type || 'output'}|${a.subfolder || ''}|${a.filename}`
}

export function useHiddenAssets() {
  const isHidden = (a: { type?: string; subfolder?: string; filename: string }) =>
    hidden.value.has(assetKey(a))

  function hide(a: { type?: string; subfolder?: string; filename: string }) {
    hidden.value = new Set(hidden.value).add(assetKey(a))
    persist()
  }

  function unhide(a: { type?: string; subfolder?: string; filename: string }) {
    const next = new Set(hidden.value)
    next.delete(assetKey(a))
    hidden.value = next
    persist()
  }

  function clear() {
    hidden.value = new Set()
    persist()
  }

  const count = computed(() => hidden.value.size)

  return { hidden, isHidden, hide, unhide, clear, count }
}
