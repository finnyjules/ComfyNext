/**
 * Cached client for the character registry. Module-level shared state: one
 * fetch feeds every consumer (surface, picker, panel, canvas nodes). Any code
 * that mutates the registry must dispatch `comfynext:charactersChanged` so
 * every view refreshes.
 */
import { ref } from 'vue'
import { viewRefUrl } from '~/lib/shotdirector/refUpload'

export interface CharacterClient {
  name: string
  slug: string
  refImages: string[]
  coverIndex: number
  loraName: string | null
  trigger: string | null
  notes: string
}

const characters = ref<CharacterClient[]>([])
const loading = ref(false)
let fetchedOnce = false
let listenerBound = false

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const res = await fetch('/api/characters-local')
    if (res.ok) {
      const data = await res.json() as { characters?: CharacterClient[] }
      characters.value = data.characters ?? []
    }
  } catch { /* offline — keep last known list */ }
  finally { fetchedOnce = true; loading.value = false }
}

export function useCharacters() {
  if (!listenerBound && typeof window !== 'undefined') {
    listenerBound = true
    window.addEventListener('comfynext:charactersChanged', () => { void refresh() })
  }
  if (!fetchedOnce && typeof window !== 'undefined') void refresh()

  function resolveRefs(slugs: string[]): Record<string, string[]> {
    const bySlug = new Map(characters.value.map(c => [c.slug, c]))
    const out: Record<string, string[]> = {}
    for (const slug of slugs) {
      out[slug] = (bySlug.get(slug)?.refImages ?? []).map(viewRefUrl)
    }
    return out
  }

  function coverUrl(c: CharacterClient): string | null {
    const f = c.refImages[c.coverIndex] ?? c.refImages[0]
    return f ? viewRefUrl(f) : null
  }

  return { characters, loading, refresh, resolveRefs, coverUrl }
}
