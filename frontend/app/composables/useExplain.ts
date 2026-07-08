interface GraphNode {
  id: number
  type: string
  title: string
  inputs: { name: string, type: string, link: number | null }[]
  outputs: { name: string, type: string, links: number[] | null }[]
  widgets_values: any[]
  properties: Record<string, any>
}

interface GraphLink {
  id: number
  origin_id: number
  origin_slot: number
  target_id: number
  target_slot: number
  type: string
}

interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

const explainActive = ref(false)
const explainPanelOpen = ref(false)
const graphData = ref<GraphData | null>(null)
const explanation = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const highlightedNodeId = ref<number | null>(null)

export function useExplain() {
  const { getLocalSetting } = useLocalSettings()

  function activateExplain() {
    explainActive.value = true
    error.value = null
  }

  function deactivateExplain() {
    explainActive.value = false
  }

  function reset() {
    explainActive.value = false
    explainPanelOpen.value = false
    graphData.value = null
    explanation.value = null
    loading.value = false
    error.value = null
    highlightedNodeId.value = null
  }

  function formatGraphForClaude(data: GraphData): string {
    const { nodes, links } = data
    const lines: string[] = []

    lines.push(`## Nodes (${nodes.length})`)
    for (const node of nodes) {
      lines.push(`\n### [${node.id}] ${node.title} (${node.type})`)

      if (node.inputs?.length) {
        lines.push('Inputs:')
        for (const inp of node.inputs) {
          const linked = inp.link != null ? ` ← link #${inp.link}` : ' (unconnected)'
          lines.push(`  - ${inp.name} [${inp.type}]${linked}`)
        }
      }

      if (node.outputs?.length) {
        lines.push('Outputs:')
        for (const out of node.outputs) {
          const linked = out.links?.length ? ` → links #${out.links.join(', #')}` : ' (unconnected)'
          lines.push(`  - ${out.name} [${out.type}]${linked}`)
        }
      }

      if (node.widgets_values?.length) {
        lines.push(`Widget values: ${JSON.stringify(node.widgets_values)}`)
      }
    }

    if (links.length) {
      lines.push(`\n## Connections (${links.length})`)
      for (const link of links) {
        const fromNode = nodes.find(n => n.id === link.origin_id)
        const toNode = nodes.find(n => n.id === link.target_id)
        const fromName = fromNode?.outputs?.[link.origin_slot]?.name || `slot ${link.origin_slot}`
        const toName = toNode?.inputs?.[link.target_slot]?.name || `slot ${link.target_slot}`
        lines.push(`  - [${fromNode?.title || link.origin_id}].${fromName} → [${toNode?.title || link.target_id}].${toName} (${link.type})`)
      }
    }

    return lines.join('\n')
  }

  async function submitExplanation(data: GraphData) {
    graphData.value = data
    explainPanelOpen.value = true
    loading.value = true
    error.value = null
    explanation.value = null

    const apiKey = getLocalSetting('ComfyNext.AI.AnthropicApiKey')

    const graphDescription = formatGraphForClaude(data)

    try {
      const res = await $fetch<{ explanation: string }>('/api/explain', {
        method: 'POST',
        body: { graphData: graphDescription, apiKey: apiKey || undefined },
      })
      explanation.value = res.explanation
    }
    catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Failed to get explanation'
    }
    finally {
      loading.value = false
    }
  }

  return {
    explainActive,
    explainPanelOpen,
    graphData,
    explanation,
    loading,
    error,
    highlightedNodeId,
    activateExplain,
    deactivateExplain,
    reset,
    submitExplanation,
  }
}
