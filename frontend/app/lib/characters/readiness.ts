import type { CharacterState } from '#shared/characters/types'

export type ReadinessKey = 'not-built' | 'not-tested' | 'partial' | 'ready'

export interface Readiness {
  key: ReadinessKey
  label: string
  tone: 'grey' | 'amber' | 'blue'
}

export function readiness(
  state: Pick<CharacterState, 'status' | 'sheetImage' | 'stressResult'>,
): Readiness {
  // locked → Ready/blue regardless of other fields
  if (state.status === 'locked') {
    return { key: 'ready', label: 'Ready', tone: 'blue' }
  }

  // no sheetImage → Not built/grey
  if (!state.sheetImage) {
    return { key: 'not-built', label: 'Not built', tone: 'grey' }
  }

  // testing with stressResult → N/10 poses/amber
  if (state.status === 'testing' && state.stressResult) {
    const { passes, total } = state.stressResult
    return { key: 'partial', label: `${passes}/${total} poses`, tone: 'amber' }
  }

  // else → Not tested/grey
  return { key: 'not-tested', label: 'Not tested', tone: 'grey' }
}
