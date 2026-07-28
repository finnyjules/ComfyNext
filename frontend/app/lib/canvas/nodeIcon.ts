import { getPartnerIcon } from '~/lib/partnerIcons'
import { TOOLBOX_NODE_ICONS } from '~/data/toolbox-items'
import { getGeneratorIcon } from '~/data/generator-icons'

// Node icon resolution, extracted from the computeds at ComfyNode.vue:85-98 so
// the capsule and the card cannot drift apart.
//
// The awkward part is that the three sources do not agree on a return type:
// getGeneratorIcon and TOOLBOX_NODE_ICONS give Vue components, while
// getPartnerIcon gives a URL string that has to be rendered as an <img>. This
// returns a tagged union so the caller renders the right element rather than
// guessing from typeof.

export type NodeIcon =
  | { kind: 'component'; value: unknown }
  | { kind: 'url'; value: string }
  | null

/** Precedence matches ComfyNode.vue:1332-1337 (subgraph icon aside — that
 *  branch depends on data.isSubgraph, which is out of scope here): what the
 *  node DOES beats who runs it, and the toolbox catalog is the last resort. */
export function resolveNodeIcon(opts: { nodeType?: string; category?: string }): NodeIcon {
  const nodeType = opts.nodeType ?? ''

  const generator = nodeType ? getGeneratorIcon(nodeType) : null
  if (generator) return { kind: 'component', value: generator }

  const partner = getPartnerIcon(opts.category ?? '')
  if (partner) return { kind: 'url', value: partner }

  const toolbox = nodeType ? TOOLBOX_NODE_ICONS[nodeType] : null
  if (toolbox) return { kind: 'component', value: toolbox }

  return null
}
