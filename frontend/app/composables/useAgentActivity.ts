import { ref } from 'vue'

/**
 * Shared "the canvas agent is thinking" flag. The prompt bar (which owns the
 * agent) sets it; the dot-grid background reads it to animate while the agent
 * plans. Module-level ref = one shared instance across components.
 */
const thinking = ref(false)

export function useAgentActivity() {
  return { thinking }
}
