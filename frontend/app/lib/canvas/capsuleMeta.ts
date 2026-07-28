import type { ReadoutRule } from '~/lib/canvas/capsuleReadout'

// Which node types collapse, and what their read-out says.
//
// There is no unified node registry in this codebase — ToolboxItem
// (data/toolbox-items.ts), AgentCapability (lib/agent/capabilities.ts) and
// GENERATOR_NODE_ICONS (data/generator-icons.ts) are three disjoint ones and
// none covers all 28 vue-flow types. Rather than widen one of them and drag
// its consumers along, capsule concerns live here.

export type CollapseTier =
  /** No visual output of its own — a capsule from the moment it exists. */
  | 'always'
  /** Produces something visible downstream; the capsule becomes the record of
   *  how it got there. Opens when freshly added, settles after a clean run. */
  | 'after-run'
  /** This IS the content. Never collapses. */
  | 'never'
  /** Renders a live preview that is most of its value, so the user decides. */
  | 'manual'

/** Keyed by vue-flow node type — the keys of nodeTypes in VueNodeCanvas.vue. */
export const COLLAPSE_TIERS: Record<string, CollapseTier> = {
  comfy: 'after-run',
  gate: 'always',
  'subgraph-io': 'always',

  'pose-mannequin': 'after-run',
  'lip-sync': 'after-run',
  'shot-director': 'after-run',

  note: 'never',
  'artifact-image': 'never',
  'artifact-text': 'never',
  'artifact-audio': 'never',
  'artifact-video': 'never',
  'artifact-frame': 'never',
  'artifact-timeline': 'never',
  'artifact-3d': 'never',
  'character-sheet': 'never',
  collection: 'never',
  'batch-grid': 'never',
  'sketch-pile': 'never',

  // Live WebGL preview + manifest-driven sliders on the card itself — the same
  // shape as the studios below, not a fire-and-forget step.
  reference: 'manual',
  character: 'manual',
  'shader-effect': 'manual',
  'space-type': 'manual',
  'gradient-studio': 'manual',
  'shader-studio': 'manual',
  'texture-studio': 'manual',
  'shape-studio': 'manual',
  'vector-type': 'manual',
  'scene3d-studio': 'manual',
}

/** Unknown types default to 'never' — a node type nobody has classified should
 *  never be silently hidden behind a capsule. */
export function collapseTier(vueFlowType: string): CollapseTier {
  return COLLAPSE_TIERS[vueFlowType] ?? 'never'
}

export function defaultCollapsed(vueFlowType: string, hasRun: boolean): boolean {
  const tier = collapseTier(vueFlowType)
  if (tier === 'always') return true
  if (tier === 'after-run') return hasRun
  return false
}

/** Keyed by Comfy class_type (node.data.nodeType), not vue-flow type. */
export const READOUT_RULES: Record<string, ReadoutRule> = {
  KSampler: { from: 'widgets', parts: [{ name: 'steps', suffix: ' steps' }, { name: 'cfg', prefix: 'guidance ' }] },
  CLIPTextEncode: { from: 'text', property: 'text', max: 28 },
  EmptyLatentImage: { from: 'widgets', parts: [{ name: 'width', suffix: '' }, { name: 'height', prefix: '× ' }] },
  CheckpointLoaderSimple: { from: 'widgets', parts: [{ name: 'ckpt_name' }] },
  LoraLoader: { from: 'widgets', parts: [{ name: 'lora_name' }, { name: 'strength_model', prefix: 'strength ' }] },
}

export function readoutRuleFor(comfyNodeType: string): ReadoutRule | undefined {
  return READOUT_RULES[comfyNodeType]
}
