type NodeSource = 'core' | 'essentials' | 'partner' | 'extensions'

interface NodeType {
  name: string
  displayName: string
  description: string
  category: string
  source: NodeSource
  inputs: { name: string; type: string }[]
  outputs: { name: string; type: string }[]
}

const nodeSearchOpen = ref(false)
const nodeTypes = ref<NodeType[]>([])
const searchQuery = ref('')
const activeFilter = ref('most-relevant')
const selectedIndex = ref(0)
let fetchedOnce = false

function classifySource(pythonModule: string): NodeSource {
  if (!pythonModule) return 'core'
  if (pythonModule.startsWith('comfy_api_nodes')) return 'partner'
  if (pythonModule.startsWith('comfy_extras')) return 'essentials'
  if (pythonModule.startsWith('custom_nodes')) return 'extensions'
  return 'core'
}

const SOURCE_FILTERS = ['essentials', 'partner', 'core', 'extensions']

export function useNodeSearch() {
  // Top-level node categories (sampling, loaders, etc.)
  const categories = computed(() => {
    const cats = new Set<string>()
    for (const n of nodeTypes.value) {
      if (n.category) {
        const top = n.category.split('/')[0]
        if (top && top !== '_for_testing') cats.add(top)
      }
    }
    return Array.from(cats).sort()
  })

  const filteredNodes = computed(() => {
    let nodes = nodeTypes.value
    const f = activeFilter.value

    // Source filter
    if (SOURCE_FILTERS.includes(f)) {
      nodes = nodes.filter((n) => n.source === f)
    }
    // Category filter (not a built-in group)
    else if (f !== 'most-relevant' && f !== 'recents' && f !== 'favorites') {
      nodes = nodes.filter(
        (n) => n.category === f || n.category.startsWith(f + '/'),
      )
    }
    // 'most-relevant', 'recents', 'favorites' → show all

    // Text search
    const q = searchQuery.value.toLowerCase().trim()
    if (q) {
      nodes = nodes.filter(
        (n) =>
          n.displayName.toLowerCase().includes(q)
          || n.name.toLowerCase().includes(q)
          || n.description.toLowerCase().includes(q)
          || n.category.toLowerCase().includes(q),
      )
    }

    return nodes.slice(0, 100)
  })

  async function fetchNodeTypes() {
    if (fetchedOnce && nodeTypes.value.length > 0) return
    try {
      const data = await $fetch<Record<string, any>>('/object_info')
      const types: NodeType[] = []
      for (const [name, info] of Object.entries(data)) {
        const inputs: { name: string; type: string }[] = []
        if (info.input?.required) {
          for (const [k, v] of Object.entries(info.input.required as Record<string, any>)) {
            inputs.push({ name: k, type: Array.isArray(v) ? String(v[0]) : String(v) })
          }
        }
        const outputs: { name: string; type: string }[] = []
        if (info.output) {
          const names = info.output_name || info.output
          for (let i = 0; i < info.output.length; i++) {
            outputs.push({
              name: String(names[i] || info.output[i]),
              type: String(info.output[i]),
            })
          }
        }
        types.push({
          name,
          displayName: info.display_name || name,
          description: info.description || '',
          category: info.category || '',
          source: classifySource(info.python_module || ''),
          inputs,
          outputs,
        })
      }
      types.sort((a, b) => a.displayName.localeCompare(b.displayName))
      nodeTypes.value = types
      fetchedOnce = true
    }
    catch (err) {
      console.error('[useNodeSearch] Failed to fetch node types:', err)
    }
  }

  function openNodeSearch() {
    searchQuery.value = ''
    activeFilter.value = 'most-relevant'
    selectedIndex.value = 0
    nodeSearchOpen.value = true
    fetchNodeTypes()
  }

  function closeNodeSearch() {
    nodeSearchOpen.value = false
  }

  function addNode(nodeType: string) {
    // Check if Vue nodes mode is active
    const { vueNodesEnabled } = useVueNodesEnabled()
    if (vueNodesEnabled.value) {
      // Dispatch custom event for Vue canvas to handle
      window.dispatchEvent(new CustomEvent('comfynext:addNode', {
        detail: { nodeType },
      }))
      closeNodeSearch()
      return
    }

    // LiteGraph mode — existing iframe postMessage
    const container = document.querySelector('[data-tab-id]')
    const iframe = container?.querySelector('iframe') as HTMLIFrameElement | null
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'comfynext', action: 'addNodeAtCenter', nodeType },
        '*',
      )
    }
    closeNodeSearch()
  }

  return {
    nodeSearchOpen,
    nodeTypes,
    searchQuery,
    activeFilter,
    selectedIndex,
    categories,
    filteredNodes,
    fetchNodeTypes,
    openNodeSearch,
    closeNodeSearch,
    addNode,
  }
}
