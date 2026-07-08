// frontend/app/composables/useNextStepsStrip.ts
// Singleton coordination for reviewer-found "fix" chips. A paid render triggers
// a quiet critique pass; any fixes it finds are announced here and surfaced at
// the top of the most-recently-reviewed artifact's Edit menu — sticky until
// applied, dismissed, or invalidated by a newer render. Module-scoped ref =
// shared across the reviewing composable and the artifact node.
import { ref } from 'vue'

export interface FixChip {
  id: number
  label: string
  hint: string | null
  apply: () => void
}

const fixes = ref<{ nodeId: string; chips: FixChip[] } | null>(null)

export function useNextStepsStrip() {
  function announceFixes(nodeId: string, chips: FixChip[]) {
    fixes.value = { nodeId, chips }
  }
  function clearFixes(nodeId?: string) {
    if (!nodeId || fixes.value?.nodeId === nodeId) fixes.value = null
  }
  return { fixes, announceFixes, clearFixes }
}
