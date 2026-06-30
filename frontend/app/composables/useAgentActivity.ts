import { ref } from 'vue'

/**
 * Shared "the canvas agent is thinking" flag. The prompt bar (which owns the
 * agent) sets it; the dot-grid background reads it to animate while the agent
 * plans. Module-level ref = one shared instance across components.
 */
const thinking = ref(false)
/** Ids of the node(s) the agent is currently looking at in the review/critique
 *  pass. Each such node renders the white "scanning" dot-grid + shimmer overlay
 *  so it's clear WHICH result is under review. Empty = no review in flight. */
const analyzingNodeIds = ref<Set<string>>(new Set())

export function useAgentActivity() {
  return { thinking, analyzingNodeIds }
}
