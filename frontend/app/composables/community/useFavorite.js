import { computed } from 'vue'
import { useStore } from '@nanostores/vue'
import { $favoriteIds } from './auth.js'

export function useFavorite(workflowId) {
  const favoriteIds = useStore($favoriteIds)

  const isFavorited = computed(() => favoriteIds.value.has(workflowId))

  function toggle() {
    const current = new Set($favoriteIds.get())
    if (current.has(workflowId)) {
      current.delete(workflowId)
    } else {
      current.add(workflowId)
    }
    $favoriteIds.set(current)
  }

  return { isFavorited, toggle }
}
