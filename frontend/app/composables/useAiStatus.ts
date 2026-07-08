// Whether AI assist can work right now: the server carries a shared key
// (/api/ai-status) or this browser has a BYOK override. Module-level state —
// one fetch per session. Optimistic while unknown (null) so the setup notice
// never flashes during load.
const serverKeyConfigured = ref<boolean | null>(null)
let fetched = false

const LOCAL_KEY = 'comfynext:ComfyNext.AI.AnthropicApiKey'
const localApiKey = ref<string | null>(null)
let listenerRegistered = false

function loadLocalApiKey() {
  if (import.meta.server) return
  localApiKey.value = localStorage.getItem(LOCAL_KEY)
}

export function useAiStatus() {
  const { getLocalSetting } = useLocalSettings()
  if (import.meta.client && !fetched) {
    fetched = true
    $fetch<{ configured: boolean }>('/api/ai-status')
      .then((r) => { serverKeyConfigured.value = !!r?.configured })
      .catch(() => { serverKeyConfigured.value = null })
  }

  // Listen for setting changes (cross-tab via storage event, same-tab via custom event)
  if (import.meta.client && !listenerRegistered) {
    listenerRegistered = true
    window.addEventListener('storage', (e) => {
      if (e.key === LOCAL_KEY) loadLocalApiKey()
    })
    window.addEventListener('comfynext:setting-changed', ((e: CustomEvent) => {
      if (e.detail?.key === LOCAL_KEY) loadLocalApiKey()
    }) as EventListener)
    loadLocalApiKey()
  }

  const aiAvailable = computed(() => {
    if (localApiKey.value ?? getLocalSetting('ComfyNext.AI.AnthropicApiKey')) return true
    return serverKeyConfigured.value !== false
  })
  return { serverKeyConfigured, aiAvailable }
}
