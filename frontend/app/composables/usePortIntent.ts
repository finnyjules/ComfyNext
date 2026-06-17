import type { PortAnchor } from '~/lib/portIntent'
import { buildCatalog } from '~/lib/portIntentCatalog'
import { validateSuggestion, type ValidationResult } from '~/lib/portIntentValidate'
import { NODE_KEYWORDS } from '~/lib/nodeKeywords'

interface SuggestContext {
  objectInfo: Record<string, any>
  nodes: any[]
  edges: any[]
}

export function usePortIntent() {
  const { getLocalSetting } = useLocalSettings()
  const { nodeTypes, fetchNodeTypes } = useNodeSearch()

  // Small summary of the graph around the anchor so the model knows the context
  // (same spirit as useExplain's formatGraphForClaude, scoped to neighbors).
  function buildGraphContext(anchor: PortAnchor, nodes: any[], edges: any[]): string {
    const byId = new Map(nodes.map(n => [n.id, n]))
    const lines: string[] = []
    const anchorNode = byId.get(anchor.nodeId)
    if (anchorNode) {
      lines.push(`Anchor node: [${anchorNode.id}] ${anchorNode.data?.title} (${anchorNode.data?.nodeType})`)
    }
    const neighborIds = new Set<string>()
    for (const e of edges) {
      if (e.source === anchor.nodeId) neighborIds.add(e.target)
      if (e.target === anchor.nodeId) neighborIds.add(e.source)
    }
    for (const id of neighborIds) {
      const n = byId.get(id)
      if (n) lines.push(`Connected: [${n.id}] ${n.data?.title} (${n.data?.nodeType})`)
    }
    return lines.join('\n') || 'The anchor node has no connections yet.'
  }

  async function callEndpoint(payload: Record<string, unknown>) {
    return await $fetch<{ suggestion: unknown }>('/api/pipeline-suggest', {
      method: 'POST',
      body: payload,
    })
  }

  /** Resolve an intent into a validated suggestion. One repair retry on
   *  validation failure; throws with a user-readable message otherwise. */
  async function suggest(intent: string, anchor: PortAnchor, ctx: SuggestContext): Promise<ValidationResult> {
    const apiKey = getLocalSetting('ComfyNext.AI.AnthropicApiKey')
    if (!apiKey) throw new Error('No Anthropic API key set. Add your key in Settings → AI.')

    await fetchNodeTypes()
    const catalog = buildCatalog(nodeTypes.value, ctx.objectInfo, anchor, { intent, keywords: NODE_KEYWORDS })
    if (!catalog.length) throw new Error('No installed nodes are compatible with this port.')
    const graphContext = buildGraphContext(anchor, ctx.nodes, ctx.edges)
    const base = { apiKey, intent, anchor, catalog, graphContext }

    let res = await callEndpoint(base)
    let validated = validateSuggestion(res.suggestion, ctx.objectInfo, anchor)
    if (!validated.ok) {
      res = await callEndpoint({ ...base, previousAttempt: res.suggestion, validationErrors: validated.errors })
      validated = validateSuggestion(res.suggestion, ctx.objectInfo, anchor)
    }
    if (!validated.ok) {
      throw new Error(`The AI couldn't build a valid pipeline: ${validated.errors[0]}`)
    }
    return validated
  }

  return { suggest }
}
