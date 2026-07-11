const vueNodesEnabled = ref(true)
let listenerRegistered = false

/** Default-ON: only an explicit 'false' (Settings toggle) disables the Vue canvas. */
export function vueNodesDefault(stored: string | null): boolean {
  return stored !== 'false'
}

export function useVueNodesEnabled() {
  function load() {
    if (import.meta.server) return
    vueNodesEnabled.value = vueNodesDefault(localStorage.getItem('sailor:Comfy.VueNodes.Enabled'))
  }

  // Listen for setting changes (cross-tab via storage event, same-tab via custom event)
  if (import.meta.client && !listenerRegistered) {
    listenerRegistered = true
    window.addEventListener('storage', (e) => {
      if (e.key === 'sailor:Comfy.VueNodes.Enabled') load()
    })
    window.addEventListener('sailor:setting-changed', ((e: CustomEvent) => {
      if (e.detail?.key === 'sailor:Comfy.VueNodes.Enabled') load()
    }) as EventListener)
    load()
  }

  return { vueNodesEnabled, reloadSetting: load }
}
