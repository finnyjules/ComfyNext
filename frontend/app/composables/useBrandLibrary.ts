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
  const res = await fetch(`/api/brand-kits/${entry.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
  if (!res.ok) throw new Error(`save kit failed: ${res.status}`)
  await refresh()
}

async function remove(id: string): Promise<void> {
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
