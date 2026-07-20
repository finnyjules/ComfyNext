/**
 * Node visual tier.
 *
 * The canvas used to give every node the same weight, so a reroute read as
 * loudly as a generator and the eye landed on plumbing instead of on the work.
 * Nodes are now sorted by one question: does this node carry content you author
 * or read?
 *
 *   dominant  — generators, artifacts, studios, composition surfaces. Large,
 *               media edge-to-edge, full opacity. The graph should read as
 *               "images, connected by machinery".
 *   recessive — config-only pass-throughs with nothing to show. Narrower,
 *               dimmer, compact header.
 *
 * Most of the gain comes from the recessive tier getting out of the way, not
 * from the dominant tier growing louder.
 */
export type NodeTier = 'dominant' | 'recessive'

/**
 * Pass-through utilities: you wire through them, you don't stop and look at
 * them. Everything not listed here is dominant, so a new content-carrying node
 * gets the right treatment without being registered.
 *
 * Compositor, SmartLayout, PoseMannequin and Collection are deliberately absent
 * — they're destinations you compose *in*, not steps you pass through.
 */
const RECESSIVE_NODE_TYPES = new Set<string>([
  // Structural
  'Reroute',
  'ComfyGate',
  'SubgraphInput',
  'SubgraphOutput',
  // Enhance / repair — you pass through these on the way to a result
  'UpscaleImageNode',
  'EnhanceDetailNode',
  'RestorePhotoNode',
  'FixFacesNode',
  'RemoveBackgroundNode',
  'RemoveObjectNode',
  // Framing / transition utilities
  'LensReframe',
  'LensBlur',
  'VideoCrossfade',
  'MaskExtractor',
  'Ascii',
])

export function nodeTier(nodeType: string | undefined | null): NodeTier {
  if (!nodeType) return 'dominant'
  return RECESSIVE_NODE_TYPES.has(nodeType) ? 'recessive' : 'dominant'
}

export function isRecessive(nodeType: string | undefined | null): boolean {
  return nodeTier(nodeType) === 'recessive'
}
