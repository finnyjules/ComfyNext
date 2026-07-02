/**
 * Cached client for the character registry. Module-level shared state: one
 * fetch feeds every consumer (surface, picker, panel, canvas nodes). Any code
 * that mutates the registry must dispatch `comfynext:charactersChanged` so
 * every view refreshes.
 */
import { ref } from 'vue'
import { viewRefUrl } from '~/lib/shotdirector/refUpload'

export interface CharacterVariantClient {
  id: string
  label: string
  descriptor: string
  refImages: string[]
  coverIndex: number
}

export interface CharacterClient {
  name: string
  slug: string
  variants: CharacterVariantClient[]
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

function pickVariant(c: CharacterClient, variantId?: string): CharacterVariantClient | undefined {
  const byId = variantId ? c.variants.find(v => v.id === variantId) : undefined
  return byId ?? c.variants.find(v => v.id === 'default') ?? c.variants[0]
}

export function useCharacters() {
  if (!listenerBound && typeof window !== 'undefined') {
    listenerBound = true
    window.addEventListener('comfynext:charactersChanged', () => { void refresh() })
  }
  if (!fetchedOnce && typeof window !== 'undefined') void refresh()

  /**
   * Resolve a list of { slug, variantId? } picks to /view URLs, keyed by slug.
   * Unknown variant ids (or omitted) fall back to the character's default variant.
   * Unknown slugs map to an empty array.
   */
  function resolveVariantRefs(picks: { slug: string; variantId?: string }[]): Record<string, string[]> {
    const bySlug = new Map(characters.value.map(c => [c.slug, c]))
    const out: Record<string, string[]> = {}
    for (const { slug, variantId } of picks) {
      const c = bySlug.get(slug)
      const variant = c ? pickVariant(c, variantId) : undefined
      out[slug] = (variant?.refImages ?? []).map(viewRefUrl)
    }
    return out
  }

  /** Thin wrapper over resolveVariantRefs for callers that don't care about variants. */
  function resolveRefs(slugs: string[]): Record<string, string[]> {
    return resolveVariantRefs(slugs.map(slug => ({ slug })))
  }

  function coverUrl(c: CharacterClient, variantId?: string): string | null {
    const variant = pickVariant(c, variantId)
    if (!variant) return null
    const f = variant.refImages[variant.coverIndex] ?? variant.refImages[0]
    return f ? viewRefUrl(f) : null
  }

  return { characters, loading, refresh, resolveVariantRefs, resolveRefs, coverUrl }
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

export type CharacterStatus = 'draft' | 'training' | 'ready'

/** Minimal shape of a training-queue job needed to derive character status. */
export interface TrainingJobLike {
  status: string
  loraKind?: string
  displayName?: string
  outputName?: string
}

const IN_FLIGHT_STATUSES = new Set(['queued', 'starting', 'processing'])

/** Loosely normalize a name for outputName comparison (lowercase, alnum-only). */
function slugish(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Pure status derivation: ready if the character already has a linked LoRA;
 * training if a matching in-flight character-kind job exists in the queue;
 * else draft.
 */
export function characterStatus(c: CharacterClient, jobs: TrainingJobLike[]): CharacterStatus {
  if (c.loraName) return 'ready'
  const nameSlug = slugish(c.name)
  const training = jobs.some(job =>
    IN_FLIGHT_STATUSES.has(job.status)
    && job.loraKind === 'character'
    && (
      (job.displayName ?? '').toLowerCase() === c.name.toLowerCase()
      || slugish(job.outputName ?? '') === nameSlug
    ))
  return training ? 'training' : 'draft'
}

// ---------------------------------------------------------------------------
// Training jobs poll
// ---------------------------------------------------------------------------

const jobs = ref<TrainingJobLike[]>([])
const pollingEnabled = ref(false)
let pollHandle: ReturnType<typeof setInterval> | null = null

async function refreshJobs(): Promise<void> {
  try {
    const res = await fetch('/api/training-queue')
    if (res.ok) {
      const data = await res.json() as { jobs?: TrainingJobLike[] }
      jobs.value = data.jobs ?? []
    }
  } catch { /* offline — keep last known list */ }
}

function startPolling(): void {
  if (pollHandle || typeof window === 'undefined') return
  pollHandle = setInterval(() => { void refreshJobs() }, 15_000)
}

function stopPolling(): void {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null }
}

/**
 * Mini-composable over the training-queue registry. Module-level `jobs` so
 * every consumer shares one poll. Polling only runs while some consumer has
 * set `pollingEnabled.value = true` (e.g. the character panel while open).
 */
export function useTrainingJobs() {
  if (typeof window !== 'undefined') void refreshJobs()

  function setPolling(enabled: boolean): void {
    pollingEnabled.value = enabled
    if (enabled) startPolling()
    else stopPolling()
  }

  return { jobs, pollingEnabled, refreshJobs, setPolling }
}
