// Copy assistant composable — variations / write-from-brief / translate,
// mirrors useVibeControl's key-reading + $fetch pattern against the
// /api/copy-assist Nitro route (Task 4's contract, see
// .superpowers/sdd/cf-task-4-report.md). Kept response-shape-only on the
// client: the server owns the prompt/schema construction.

export type CopyAssistMode = 'variations' | 'brief' | 'translate'

export interface CopyAssistOption {
  text: string
  language?: string
}

export interface CopyAssistContext {
  brandTone?: string
  otherTexts?: string[]
}

export interface CopyAssistPayload {
  mode: CopyAssistMode
  text?: string
  brief?: string
  languages?: string[]
  count?: number
  context?: CopyAssistContext
}

export function useCopyAssist() {
  const { getLocalSetting } = useLocalSettings()

  const options = ref<CopyAssistOption[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  function clear() {
    options.value = []
    error.value = null
  }

  async function run(payload: CopyAssistPayload): Promise<void> {
    if (loading.value) return // guard against double-fire

    const apiKey = getLocalSetting('ComfyNext.AI.AnthropicApiKey')
    if (!apiKey) {
      error.value = 'Add your Anthropic key in settings'
      return
    }

    loading.value = true
    error.value = null
    try {
      const res = await $fetch<{ options: CopyAssistOption[] }>('/api/copy-assist', {
        method: 'POST',
        body: { apiKey, ...payload },
      })
      options.value = res.options ?? []
    } catch (e: any) {
      // $fetch surfaces server createError(...) messages under data.message /
      // data.statusMessage depending on Nitro version — check both, else fall
      // back to the generic error message.
      error.value = e?.data?.message ?? e?.data?.statusMessage ?? e?.message ?? 'Copy assistant failed.'
    } finally {
      loading.value = false
    }
  }

  return { options, loading, error, run, clear }
}
