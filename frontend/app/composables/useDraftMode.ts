/** Draft/Final render mode, per project tab. Module singleton so the header
 *  chip, run path and restore path all see the same state. Default: Final. */
import { ref } from 'vue'

const draftByTab = ref<Record<string, boolean>>({})

export function useDraftMode() {
  function isDraft(tabId: string): boolean {
    return !!draftByTab.value[tabId]
  }
  function setDraft(tabId: string, v: boolean): void {
    draftByTab.value = { ...draftByTab.value, [tabId]: v }
  }
  function toggle(tabId: string): void {
    setDraft(tabId, !isDraft(tabId))
  }
  return { isDraft, setDraft, toggle }
}
