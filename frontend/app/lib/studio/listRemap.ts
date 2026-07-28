/**
 * Positional-path remapping for studio layer stacks.
 *
 * Several studios keep an ordered list of layers (Gradient's `layers[]`,
 * Shader's `effects[]`) and address them from motion tracks by *positional*
 * dotted path — `layers.2.shape.count`. Splicing the array therefore silently
 * re-aims every track at whatever slid into the slot, and nothing throws. These
 * three functions rewrite the index segment so a track follows its layer.
 *
 * Extracted verbatim from `gradientfx/motion.ts` (the tested original) because
 * `ShaderStudioSurface.vue` had copy-pasted all three inline — a third stack
 * would have triplicated them. Gradient re-exports these under their original
 * names; its call sites and spec are untouched.
 *
 * NOTE for new stacks: prefer **stable ids** (`lib/studio/idPath.ts`) over
 * positional paths. Then reorder is a no-op and there is nothing to remap.
 */

/** Anything carrying an optional dotted `path` — both studios' `MotionTrack`. */
export interface PathBearing { path?: string }

/**
 * How a list's positional paths are shaped.
 *
 * - Gradient: `{ list: 'layers' }`            → `^layers\.(\d+)\.([\s\S]*)$`
 * - Shader:   `{ list: 'effects', mid: 'params', requireLeaf: true }`
 *                                             → `^effects\.(\d+)\.params\.(.+)$`
 *
 * `requireLeaf` exists because the two originals were *not* identical: Gradient
 * matched a bare prefix and kept whatever followed, while Shader required a
 * non-empty single-line leaf. A generic matcher that quietly dropped that
 * requirement would start rewriting paths Shader deliberately left alone, so it
 * is a knob rather than a unified default.
 */
export interface ListPathScheme {
  /** The list's key in the config, e.g. `layers` / `effects`. */
  list: string
  /** Fixed segment between the index and the leaf, e.g. `params` for Shader. */
  mid?: string
  /** Require a non-empty, single-line remainder after the prefix (Shader's `(.+)$`). */
  requireLeaf?: boolean
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Build the scheme's matcher. Group 1 is the index, group 2 the remainder. */
export function listPathRe(scheme: ListPathScheme): RegExp {
  const mid = scheme.mid ? `${escapeRe(scheme.mid)}\\.` : ''
  // `[\s\S]*` (not `.*`) so an unconstrained tail keeps the original prefix-only
  // matcher's behaviour exactly, including empty and newline-bearing remainders.
  const tail = scheme.requireLeaf ? '(.+)$' : '([\\s\\S]*)$'
  return new RegExp(`^${escapeRe(scheme.list)}\\.(\\d+)\\.${mid}${tail}`)
}

export interface ListRemap {
  /** The scheme's compiled matcher — exposed so callers can pin it in tests. */
  re: RegExp
  /** The list index a path targets, or null when the path is not in this list. */
  indexOf(path: string | undefined): number | null
  /** The same path re-pointed at index `i`. Returns `path` unchanged if it doesn't match. */
  withIndex(path: string, i: number): string
  /** Tracks re-pointed to follow a layer moved from `from` to `to`. */
  onReorder<T extends PathBearing>(tracks: T[], from: number, to: number): T[]
  /** Tracks on `removed` dropped, higher indices decremented. */
  onRemove<T extends PathBearing>(tracks: T[], removed: number): T[]
  /** Tracks at or above `at` shifted up one, for a layer inserted at `at`. */
  onInsert<T extends PathBearing>(tracks: T[], at: number): T[]
}

export function makeListRemap(scheme: ListPathScheme): ListRemap {
  const re = listPathRe(scheme)
  const midPart = scheme.mid ? `${scheme.mid}.` : ''

  const indexOf = (path: string | undefined): number | null => {
    const m = re.exec(path ?? '')
    return m ? Number(m[1]) : null
  }

  const withIndex = (path: string, i: number): string => {
    const m = re.exec(path)
    return m ? `${scheme.list}.${i}.${midPart}${m[2]}` : path
  }

  return {
    re,
    indexOf,
    withIndex,

    onReorder<T extends PathBearing>(tracks: T[], from: number, to: number): T[] {
      return tracks.map((tr) => {
        const i = indexOf(tr.path)
        if (i === null) return tr
        let next = i
        if (i === from) next = to
        else if (from < i && i <= to) next = i - 1
        else if (to <= i && i < from) next = i + 1
        return next === i ? tr : ({ ...tr, path: withIndex(tr.path!, next) } as T)
      })
    },

    onRemove<T extends PathBearing>(tracks: T[], removed: number): T[] {
      const out: T[] = []
      for (const tr of tracks) {
        const i = indexOf(tr.path)
        if (i === null) { out.push(tr); continue }
        if (i === removed) continue
        out.push(i > removed ? ({ ...tr, path: withIndex(tr.path!, i - 1) } as T) : tr)
      }
      return out
    },

    onInsert<T extends PathBearing>(tracks: T[], at: number): T[] {
      return tracks.map((tr) => {
        const i = indexOf(tr.path)
        if (i === null || i < at) return tr
        return { ...tr, path: withIndex(tr.path!, i + 1) } as T
      })
    },
  }
}
