/**
 * Lists the user's trained STYLE LoRAs that can be run for generation (have a
 * private Replicate model). Powers the Generate Object style picker.
 */
export interface StyleItem { filename: string; name: string; coverUrl: string | null }

/** Pure filter: style LoRAs (not characters) that have a runnable trained model. */
export function selectGeneratableStyles(loras: any[]): StyleItem[] {
  if (!Array.isArray(loras)) return []
  return loras
    .filter((l) => l && l.kind !== 'character' && l.canGenerateCover)
    .map((l) => ({ filename: String(l.filename), name: String(l.name || l.filename), coverUrl: l.coverUrl ?? null }))
}

export function useStyleList() {
  const styles = ref<StyleItem[]>([])
  const loading = ref(false)
  const error = ref('')

  async function refresh() {
    loading.value = true; error.value = ''
    try {
      const res = await $fetch<{ loras: any[] }>('/api/loras-local')
      styles.value = selectGeneratableStyles(res?.loras ?? [])
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Could not load styles'
    } finally {
      loading.value = false
    }
  }

  return { styles, loading, error, refresh }
}
