const vueNodesEnabled = ref(false)
let listenerRegistered = false

export function useVueNodesEnabled() {
  function load() {
    if (import.meta.server) return
    vueNodesEnabled.value = localStorage.getItem('comfynext:Comfy.VueNodes.Enabled') === 'true'
  }

  // Listen for setting changes (cross-tab via storage event, same-tab via custom event)
  if (import.meta.client && !listenerRegistered) {
    listenerRegistered = true
    window.addEventListener('storage', (e) => {
      if (e.key === 'comfynext:Comfy.VueNodes.Enabled') load()
    })
    window.addEventListener('comfynext:setting-changed', ((e: CustomEvent) => {
      if (e.detail?.key === 'comfynext:Comfy.VueNodes.Enabled') load()
    }) as EventListener)
    load()
  }

  return { vueNodesEnabled, reloadSetting: load }
}
