// frontend/app/lib/spacetype/stateSource.ts
/** Where a Space Type studio reads and writes its state. Two implementations:
 *  a canvas node (today's behaviour) and a timeline clip (edit-in-place). The
 *  studio consumes this interface instead of hard-coding the node path — the
 *  seam symbols/instances (spec 2) will later hang off. */
import type { SpaceTypeState } from '~~/shared/spacetype/state'
import { useTimelineStore } from '~/composables/useTimelineStore'

export interface SpaceTypeStateSource {
  /** Current state, or null when there is nothing saved yet (fresh node). The
   *  studio's loadConfig tolerates missing optional fields (seamless/W/H),
   *  so a source returns the raw blob without back-filling. */
  read(): SpaceTypeState | null
  /** Persist the full state. Implementations preserve any non-state keys they
   *  already hold (the node blob also carries `thumb`). */
  write(next: SpaceTypeState): void
  /** Short human label for the studio chrome / breadcrumb. */
  readonly label: string
}

/** State stored on a canvas node at data.properties.sailor_spaceType. */
export function nodeSpaceTypeStateSource(getNode: () => any | undefined): SpaceTypeStateSource {
  return {
    label: 'Space Type',
    read() {
      const c = getNode()?.data?.properties?.sailor_spaceType
      return c ?? null
    },
    write(next) {
      const n = getNode()
      if (!n) return
      if (!n.data) n.data = {}
      if (!n.data.properties) n.data.properties = {}
      const prev = n.data.properties.sailor_spaceType || {}
      n.data.properties.sailor_spaceType = { ...prev, ...next }
    },
  }
}

/** State stored on a timeline clip's .state. Reads/writes through the singleton
 *  timeline store, so it shares the store's undo history and persistence. */
export function clipSpaceTypeStateSource(clipId: string): SpaceTypeStateSource {
  const store = useTimelineStore()
  return {
    label: 'Space Type · clip',
    read() {
      const clip = store.state.value.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === clipId)
      return clip && clip.kind === 'spacetype' ? clip.state : null
    },
    write(next) {
      store.updateSpaceTypeClipState(clipId, next)
    },
  }
}
