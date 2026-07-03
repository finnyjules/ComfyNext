// frontend/app/composables/useNextStepsStrip.ts
// Singleton coordination for the post-render "next steps" chip strip: exactly
// one artifact (the most recently rendered) shows it, and any new render or
// dismissal replaces/clears it. Module-scoped ref = shared across components.
import { ref } from 'vue'

const active = ref<{ nodeId: string; shownAt: number } | null>(null)

export function useNextStepsStrip() {
  function announceFreshTake(nodeId: string) {
    active.value = { nodeId, shownAt: Date.now() }
  }
  function dismiss() {
    active.value = null
  }
  return { active, announceFreshTake, dismiss }
}
