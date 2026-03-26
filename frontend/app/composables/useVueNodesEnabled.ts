const vueNodesEnabled = ref(false)

export function useVueNodesEnabled() {
  function load() {
    if (import.meta.server) return
    vueNodesEnabled.value = localStorage.getItem('comfynext:Comfy.VueNodes.Enabled') === 'true'
  }

  // Listen for storage changes (from settings modal)
  if (import.meta.client) {
    window.addEventListener('storage', (e) => {
      if (e.key === 'comfynext:Comfy.VueNodes.Enabled') load()
    })
    load()
  }

  return { vueNodesEnabled, reloadSetting: load }
}
