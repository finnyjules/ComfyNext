// Whether AI assist can work right now: the server carries a shared key
// (/api/ai-status) or this browser has a BYOK override. Module-level state —
// one fetch per session. Optimistic while unknown (null) so the setup notice
// never flashes during load.
const serverKeyConfigured = ref<boolean | null>(null)
let fetched = false

export function useAiStatus() {
  const { getLocalSetting } = useLocalSettings()
  if (import.meta.client && !fetched) {
    fetched = true
    $fetch<{ configured: boolean }>('/api/ai-status')
      .then((r) => { serverKeyConfigured.value = !!r?.configured })
      .catch(() => { serverKeyConfigured.value = null })
  }
  const aiAvailable = computed(() => {
    if (getLocalSetting('ComfyNext.AI.AnthropicApiKey')) return true
    return serverKeyConfigured.value !== false
  })
  return { serverKeyConfigured, aiAvailable }
}
