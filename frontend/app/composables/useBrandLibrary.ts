/**
 * App-wide brand-kit library (file-backed via /api/brand-kits) + the active
 * kit for the current project. The ProjectDoc owns brandKitId; this
 * composable owns fetching/caching the library and resolving the id to a kit.
 */
import { ref, computed, type Ref } from 'vue'
import type { BrandKit, BrandKitEntry } from '~~/shared/brand/types'

const kits = ref<BrandKitEntry[]>([])
const loaded = ref(false)

async function refresh(): Promise<void> {
  try {
    const res = await fetch('/api/brand-kits')
    if (res.ok) kits.value = (await res.json()).kits ?? []
    loaded.value = true
  } catch { /* offline dev — keep last list */ }
}

async function save(entry: BrandKitEntry): Promise<void> {
  // Optimistic upsert so rapid successive edits (e.g. add-color then
  // rename) read each other's in-memory state instead of racing the PUT's
  // round trip and silently overwriting one another.
  const idx = kits.value.findIndex(k => k.id === entry.id)
  if (idx === -1) kits.value = [...kits.value, entry]
  else kits.value = kits.value.map((k, i) => (i === idx ? entry : k))

  try {
    const res = await fetch(`/api/brand-kits/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    if (!res.ok) throw new Error(`save kit failed: ${res.status}`)
  } catch (e) {
    // Covers both a !res.ok response AND a network-level rejection (fetch
    // throws, e.g. offline/DNS/CORS) — either way, roll back the optimistic
    // entry to server truth before the caller sees the failure.
    await refresh().catch(() => {}) // best-effort: never let rollback mask the original error
    throw e
  }
  await refresh()
}

async function remove(id: string): Promise<void> {
  // Optimistic removal — see save() above for rationale.
  kits.value = kits.value.filter(k => k.id !== id)
  await fetch(`/api/brand-kits/${id}`, { method: 'DELETE' })
  await refresh()
}

export function slugifyKitName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'kit'
}

export function useBrandLibrary(activeKitId?: Ref<string | null | undefined>) {
  if (!loaded.value) void refresh()
  const activeKit = computed<BrandKit | undefined>(() => {
    const id = activeKitId?.value
    if (!id) return undefined
    return kits.value.find(k => k.id === id)?.kit
  })
  const activeEntry = computed(() => kits.value.find(k => k.id === activeKitId?.value) ?? null)
  return { kits, loaded, refresh, save, remove, activeKit, activeEntry }
}
