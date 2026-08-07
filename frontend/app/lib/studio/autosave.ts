import { ref, watch, onBeforeUnmount } from 'vue'

/** Pure state machine (no Vue lifecycle) so it can be unit-tested with fake timers.
 *  Call onEdit() on every edit: it debounces persist(), and drives saving/saved. */
export function createAutosaveController(
  persist: () => void,
  opts: { debounceMs?: number; flashMs?: number } = {},
) {
  const { debounceMs = 400, flashMs = 1500 } = opts
  const saving = ref(false)
  const saved = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  function onEdit() {
    saving.value = true
    saved.value = false
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      persist()
      saving.value = false
      saved.value = true
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => { saved.value = false }, flashMs)
    }, debounceMs)
  }
  function dispose() { clearTimeout(saveTimer); clearTimeout(flashTimer) }
  return { saving, saved, onEdit, dispose }
}

/** Composable: fires createAutosaveController.onEdit whenever `source` changes
 *  (deep), cleans up on unmount. Returns saving/saved refs for the footer status. */
export function useStudioAutosave(
  source: () => unknown,
  persist: () => void,
  opts?: { debounceMs?: number; flashMs?: number },
) {
  const c = createAutosaveController(persist, opts)
  watch(source, c.onEdit, { deep: true })
  onBeforeUnmount(c.dispose)
  return { saving: c.saving, saved: c.saved }
}
