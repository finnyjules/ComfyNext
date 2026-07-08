import { computed, type Ref } from 'vue'
import type { ProjectDoc } from '~/lib/projectDoc'
import {
  setRef, renameRef, removeRef, type RefRegistry, type RefEntry,
} from '~/lib/refs/registry'

/**
 * Read/write the active project's `@refs` registry. Writes go straight onto
 * ProjectDoc.assetRegistry so they ride the existing autosave/versioning that
 * already persists brandKitId — no separate storage.
 */
export function useRefRegistry(doc: Ref<ProjectDoc | null | undefined>) {
  const registry = computed<RefRegistry>(() => doc.value?.assetRegistry ?? {})

  function write(next: RefRegistry) {
    if (doc.value) doc.value.assetRegistry = next
  }
  return {
    registry,
    upsert: (name: string, entry: RefEntry) => write(setRef(registry.value, name, entry)),
    rename: (from: string, to: string) => write(renameRef(registry.value, from, to)),
    remove: (name: string) => write(removeRef(registry.value, name)),
  }
}
