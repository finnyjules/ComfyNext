import type { Node, Edge } from '@vue-flow/core'

// LiteGraph workflow format
export interface LiteGraphNode {
  id: number
  type: string
  pos: [number, number]
  size: [number, number]
  flags?: Record<string, any>
  order?: number
  mode?: number // 0=normal, 2=muted, 4=bypassed
  title?: string
  properties?: Record<string, any>
  widgets_values?: any[]
  inputs?: { name: string; type: string; link: number | null }[]
  outputs?: { name: string; type: string; links: number[] | null; slot_index?: number }[]
  color?: string
  bgcolor?: string
}

export interface LiteGraphWorkflow {
  last_node_id: number
  last_link_id: number
  nodes: LiteGraphNode[]
  links: any[] // Array format: [id, origin_id, origin_slot, target_id, target_slot, type]
  groups: any[]
  config: Record<string, any>
  extra: Record<string, any>
  version: number
}

// Type color map (same palette as NodeSearchDialog.vue lines 66-76)
export const TYPE_COLORS: Record<string, string> = {
  MODEL: '#c084fc',
  CLIP: '#facc15',
  IMAGE: '#60a5fa',
  LATENT: '#f472b6',
  VAE: '#f87171',
  CONDITIONING: '#fb923c',
  MASK: '#34d399',
  INT: '#94a3b8',
  FLOAT: '#94a3b8',
  STRING: '#94a3b8',
}

export function getTypeColor(type: string): string {
  return TYPE_COLORS[type?.toUpperCase()] || '#6b7280'
}

// Cache for /object_info widget specs
const objectInfo = ref<Record<string, any>>({})
let objectInfoFetched = false

export async function fetchObjectInfo() {
  if (objectInfoFetched) return objectInfo.value
  try {
    const data = await $fetch<Record<string, any>>('/object_info')
    objectInfo.value = data
    objectInfoFetched = true
  } catch (err) {
    console.error('[useVueNodes] Failed to fetch object_info:', err)
  }
  return objectInfo.value
}

export function getWidgetDefs(nodeType: string): any[] {
  const info = objectInfo.value[nodeType]
  if (!info?.input?.required) return []
  const defs: any[] = []
  for (const [name, spec] of Object.entries(info.input.required as Record<string, any>)) {
    const specArr = Array.isArray(spec) ? spec : [spec]
    const type = Array.isArray(specArr[0]) ? 'COMBO' : String(specArr[0])
    const options = Array.isArray(specArr[0]) ? specArr[0] : undefined
    const config = specArr[1] || {}
    defs.push({ name, type, options, ...config })
  }
  // Also check optional inputs
  if (info?.input?.optional) {
    for (const [name, spec] of Object.entries(info.input.optional as Record<string, any>)) {
      const specArr = Array.isArray(spec) ? spec : [spec]
      const type = Array.isArray(specArr[0]) ? 'COMBO' : String(specArr[0])
      const options = Array.isArray(specArr[0]) ? specArr[0] : undefined
      const config = specArr[1] || {}
      defs.push({ name, type, options, ...config })
    }
  }
  return defs
}

// Use simplified types to avoid Vue Flow's deep recursive generics (TS2589)
type VueFlowNode = Node<Record<string, any>>
type VueFlowEdge = Edge<Record<string, any>>

export function useVueNodes() {
  const nodes = ref<VueFlowNode[]>([])
  const edges = ref<VueFlowEdge[]>([])
  let lastWorkflow: LiteGraphWorkflow | null = null

  function convertFromLiteGraph(workflow: LiteGraphWorkflow) {
    lastWorkflow = workflow

    nodes.value = workflow.nodes.map((lgNode) => ({
      id: String(lgNode.id),
      type: 'comfy',
      position: { x: lgNode.pos[0], y: lgNode.pos[1] },
      data: {
        nodeType: lgNode.type,
        title: lgNode.title || lgNode.type,
        inputs: lgNode.inputs || [],
        outputs: lgNode.outputs || [],
        widgetsValues: lgNode.widgets_values || [],
        widgetDefs: getWidgetDefs(lgNode.type),
        properties: lgNode.properties || {},
        mode: lgNode.mode ?? 0,
        color: lgNode.color,
        bgcolor: lgNode.bgcolor,
        size: lgNode.size,
      },
    })) as VueFlowNode[]

    edges.value = (workflow.links || [])
      .filter((link) => link != null)
      .map((link) => {
        const linkArr = Array.isArray(link) ? link : Object.values(link)
        return {
          id: `e-${linkArr[0]}`,
          source: String(linkArr[1]),
          sourceHandle: `output-${linkArr[2]}`,
          target: String(linkArr[3]),
          targetHandle: `input-${linkArr[4]}`,
          type: 'comfy',
          data: { dataType: String(linkArr[5]) },
        }
      }) as VueFlowEdge[]
  }

  function convertToLiteGraph(): LiteGraphWorkflow {
    const base = lastWorkflow || { groups: [], config: {}, extra: {}, version: 0.4 }

    const rawNodes = nodes.value as any[]
    const lgNodes: LiteGraphNode[] = rawNodes.map((n) => {
      const d = n.data || {}
      return {
        id: Number(n.id),
        type: d.nodeType,
        pos: [n.position.x, n.position.y] as [number, number],
        size: d.size || [220, 120],
        title: d.title,
        inputs: d.inputs,
        outputs: d.outputs,
        widgets_values: d.widgetsValues,
        properties: d.properties,
        mode: d.mode,
        color: d.color,
        bgcolor: d.bgcolor,
      }
    })

    // Rebuild links and update node references
    const lgLinks: any[] = []
    let linkId = 0
    // Clear existing link refs
    for (const node of lgNodes) {
      for (const input of node.inputs || []) input.link = null
      for (const output of node.outputs || []) output.links = []
    }

    for (const edge of edges.value) {
      linkId++
      const originSlot = parseInt(edge.sourceHandle?.replace('output-', '') || '0')
      const targetSlot = parseInt(edge.targetHandle?.replace('input-', '') || '0')
      lgLinks.push([
        linkId,
        Number(edge.source),
        originSlot,
        Number(edge.target),
        targetSlot,
        edge.data?.dataType || '*',
      ])

      const sourceNode = lgNodes.find((n) => n.id === Number(edge.source))
      const targetNode = lgNodes.find((n) => n.id === Number(edge.target))
      if (sourceNode?.outputs?.[originSlot]) {
        if (!sourceNode.outputs[originSlot].links) sourceNode.outputs[originSlot].links = []
        sourceNode.outputs[originSlot].links!.push(linkId)
      }
      if (targetNode?.inputs?.[targetSlot]) {
        targetNode.inputs[targetSlot].link = linkId
      }
    }

    return {
      last_node_id: Math.max(0, ...lgNodes.map((n) => n.id)),
      last_link_id: linkId,
      nodes: lgNodes,
      links: lgLinks,
      groups: base.groups,
      config: base.config,
      extra: base.extra,
      version: base.version,
    }
  }

  return {
    nodes,
    edges,
    objectInfo,
    convertFromLiteGraph,
    convertToLiteGraph,
    getTypeColor,
  }
}
