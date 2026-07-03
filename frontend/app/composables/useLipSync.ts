import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { hydrateLipSyncSheet } from '~/lib/lipsync/hydrate'
import { compileLipSync } from '~/lib/lipsync/compile'
import type { LipSyncSheet } from '~/lib/lipsync/types'

export function useLipSync(initial: unknown, persist: (s: LipSyncSheet) => void) {
  const sheet = ref<LipSyncSheet>(hydrateLipSyncSheet(initial))
  const result = computed(() => compileLipSync(sheet.value))

  const update = (mut: (s: LipSyncSheet) => LipSyncSheet) => { sheet.value = mut(sheet.value); persist(sheet.value) }
  const setFace = (face: LipSyncSheet['face']) => update(s => ({ ...s, face }))
  const setVoice = (voice: LipSyncSheet['voice']) => update(s => ({ ...s, voice }))

  return { sheet: sheet as Ref<LipSyncSheet>, result: result as ComputedRef<ReturnType<typeof compileLipSync>>, update, setFace, setVoice }
}
