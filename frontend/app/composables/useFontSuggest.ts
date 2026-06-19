import { buildSuggestRequest, type FontSuggestion } from '~/lib/fontSuggest'

/**
 * Drives the ✨ "describe a font" search shared by both font pickers. Reads the
 * Anthropic key from local settings, POSTs to /api/font-suggest, and exposes the
 * grounded suggestions. Failures are non-fatal — the picker's literal search
 * keeps working.
 */
export function useFontSuggest() {
  const { getLocalSetting } = useLocalSettings()

  const suggestions = ref<FontSuggestion[]>([])
  const loading = ref(false)
  const error = ref('')
  const hasRun = ref(false)

  function clear() {
    suggestions.value = []
    error.value = ''
    hasRun.value = false
  }

  async function suggest(query: string) {
    const apiKey = getLocalSetting('ComfyNext.AI.AnthropicApiKey')
    const req = buildSuggestRequest(apiKey, query)
    if (!req.ok) {
      error.value = req.error ?? ''
      if (req.error) { suggestions.value = []; hasRun.value = true }
      return
    }

    loading.value = true
    error.value = ''
    hasRun.value = true
    try {
      const data = await $fetch<{ suggestions: FontSuggestion[] }>('/api/font-suggest', {
        method: 'POST',
        body: req.body,
      })
      suggestions.value = data.suggestions ?? []
    }
    catch (e: any) {
      suggestions.value = []
      error.value = e?.data?.message || e?.message || 'Could not get suggestions.'
    }
    finally {
      loading.value = false
    }
  }

  return { suggestions, loading, error, hasRun, suggest, clear }
}
