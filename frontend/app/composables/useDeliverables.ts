import { computed, type ComputedRef, type Ref } from 'vue'
import type { ProjectDoc } from '~/lib/projectDoc'
import {
  addSingle, group, ungroup, rename, remove, reorder, reorderWithinSet,
  removeFromSet, isPresent, makeDeliverableId,
  type ArtifactRef, type DeliverableItem,
} from '~/lib/deliverables/model'

export function useDeliverables(docRef: Ref<ProjectDoc | null>, persist: () => void) {
  let seq = 0
  const mkId = () => makeDeliverableId((seq += 1) + Date.now())

  const items: ComputedRef<DeliverableItem[]> = computed(() => docRef.value?.deliverables ?? [])
  const count = computed(() => items.value.length)

  function commit(next: DeliverableItem[]) {
    if (!docRef.value || next === items.value) return
    docRef.value.deliverables = next
    persist()
  }

  function markReady(ref: ArtifactRef, name = ''): boolean {
    if (!docRef.value) return false
    const cur = items.value
    if (isPresent(cur, ref)) return false
    commit(addSingle(cur, ref, name))
    return true
  }
  const isReady = (ref: ArtifactRef) => isPresent(items.value, ref)

  const renameItem = (id: string, name: string) => commit(rename(items.value, id, name))
  const removeItem = (id: string) => commit(remove(items.value, id))
  const moveItem = (from: number, to: number) => commit(reorder(items.value, from, to))
  const groupItems = (ids: string[], name = 'Set') => commit(group(items.value, ids, name, mkId))
  const ungroupItem = (id: string) => commit(ungroup(items.value, id))
  const moveWithinSet = (id: string, from: number, to: number) =>
    commit(reorderWithinSet(items.value, id, from, to))
  const removeSetMember = (setId: string, index: number) =>
    commit(removeFromSet(items.value, setId, index, mkId))

  return {
    items, count, markReady, isReady, renameItem, removeItem, moveItem,
    groupItems, ungroupItem, moveWithinSet, removeSetMember,
  }
}
