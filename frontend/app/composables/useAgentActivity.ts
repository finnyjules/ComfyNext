import { ref } from 'vue'

/**
 * Shared "the canvas agent is thinking" flag. The prompt bar (which owns the
 * agent) sets it; the dot-grid background reads it to animate while the agent
 * plans. Module-level ref = one shared instance across components.
 */
const thinking = ref(false)
/** The agent is looking at a generated RESULT (the review/critique pass). Drives
 *  the dot-grid's white "scanning" fade-in + swiping shimmer. */
const analyzing = ref(false)

export function useAgentActivity() {
  return { thinking, analyzing }
}
