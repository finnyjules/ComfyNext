const directExecutionEnabled = ref(false)
let listenerRegistered = false

const STORAGE_KEY = 'sailor:Comfy.DirectExecution.Enabled'

/** Default-OFF (beta): only an explicit 'true' (Settings toggle) enables
 * direct execution. Every other stored value stays off. */
export function directExecutionDefault(stored: string | null): boolean {
  return stored === 'true'
}

export function useDirectExecutionEnabled() {
  function load() {
    if (import.meta.server) return
    directExecutionEnabled.value = directExecutionDefault(localStorage.getItem(STORAGE_KEY))
  }

  // Listen for setting changes (cross-tab via storage event, same-tab via custom event)
  if (import.meta.client && !listenerRegistered) {
    listenerRegistered = true
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) load()
    })
    window.addEventListener('sailor:setting-changed', ((e: CustomEvent) => {
      if (e.detail?.key === STORAGE_KEY) load()
    }) as EventListener)
    load()
  }

  return { directExecutionEnabled, reloadSetting: load }
}
