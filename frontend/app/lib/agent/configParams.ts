import type { Params, ParamValue } from '~/lib/spacetype/effect'
import { indexOfId } from '~/lib/studio/idPath'

/**
 * Bridge a nested reactive config object (Gradient/Shader studios use a single
 * `config` ref with deep nesting) to the flat `Params` shape that useStudioAgent
 * + describeControls/validatePatch expect.
 *
 * Keys are dotted paths resolved against the root, e.g. `flow.intensity` →
 * root.flow.intensity. A leading `layer.` segment resolves against
 * root[listKey][activeLayer()] so per-layer controls follow the active selection.
 * Reads and writes go straight through to the reactive object, so mutating a key
 * triggers the studio's deep watcher and re-renders. Missing intermediate
 * objects are created on write (mirrors the surfaces' own `??=` guards).
 *
 * `listKey` is the name of the array the `layer.` prefix expands against.
 * Gradient and Shape store theirs at `layers`, which stays the default; Vector
 * Type's appearance stack lives at `appearance`. Without the parameter a
 * `layer.*` key on that studio would resolve against a `layers` array that does
 * not exist — reads would be `undefined` and writes would be dropped on the
 * floor, silently, which is the exact class of failure the dotted keys are
 * pinned by a test to avoid.
 *
 * ## `<listKey>.<id>.<rest>` — addressing ONE member, whichever slot it is in
 *
 * The `layer.` prefix always means "the active one", which is right for an
 * inspector and wrong for anything persisted: a Collection binding or an agent
 * patch that says "the stroke" must keep meaning that stroke after the user
 * reorders the stack or selects something else. So an ABSOLUTE member path is
 * accepted too, and its member segment may be a stable **id** instead of an
 * index — `appearance.Lstroke.width`.
 *
 * `getByPath`/`setByPath` are naive traversal: handed `appearance.Lstroke.width`
 * they would create a property literally named `Lstroke` ON THE ARRAY and write
 * into it, growing junk that is then saved and never read. So the id is resolved
 * to a real position first, via the shared `indexOfId`, and an id that resolves
 * to nothing makes the whole key **dead** — reads are `undefined`, writes are
 * dropped. That is the one behaviour that matters: a binding to a deleted layer
 * must degrade to ignored, never to whichever layer slid into its slot.
 *
 * Additive for the other studios: an all-digit member segment is still a plain
 * index, and no other studio declares a key beginning `<listKey>.`.
 */
type AnyObj = Record<string, unknown>

const isIndex = (k: string): boolean => /^\d+$/.test(k)

export function makeConfigParams(
  root: () => unknown,
  activeLayer: () => number = () => 0,
  listKey = 'layers',
  idKey = 'id',
): Params {
  function base(key: string): { obj: AnyObj | null; parts: string[] } {
    const parts = key.split('.')
    let obj = root() as AnyObj | null
    if (parts[0] === 'layer') {
      const layers = (obj as AnyObj | null)?.[listKey] as AnyObj[] | undefined
      obj = layers?.[activeLayer()] ?? null
      parts.shift()
      return { obj, parts }
    }
    const member = parts[1]
    if (parts[0] === listKey && member !== undefined) {
      // Refuse rather than guess — see the header. `null` makes read `undefined`
      // and write a no-op, so nothing is fabricated on the array.
      //
      // An OUT-OF-RANGE positional index is refused for the same reason an
      // unknown id is: `write` creates missing containers, so `appearance.5.width`
      // on a two-layer stack would grow a sparse array of empty objects that the
      // renderer then reads as real layers. `resolveIdPath` takes exactly this
      // posture (`lib/studio/idPath.ts`).
      const list = (obj as AnyObj | null)?.[listKey]
      if (!Array.isArray(list)) return { obj: null, parts }
      const i = isIndex(member) ? Number(member) : indexOfId(obj, listKey, member, idKey)
      if (i === undefined || i < 0 || i >= list.length) return { obj: null, parts }
      parts[1] = String(i)
    }
    return { obj, parts }
  }

  function read(key: string): ParamValue | undefined {
    const { obj, parts } = base(key)
    let cur: unknown = obj
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return undefined
      cur = (cur as AnyObj)[p]
    }
    return cur as ParamValue | undefined
  }

  function write(key: string, value: ParamValue): void {
    const { obj, parts } = base(key)
    if (!obj) return
    let cur: AnyObj = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!
      let next = cur[p]
      if (next == null || typeof next !== 'object') { next = {}; cur[p] = next }
      cur = next as AnyObj
    }
    cur[parts[parts.length - 1]!] = value
  }

  return new Proxy({} as Params, {
    get: (_t, key) => (typeof key === 'string' ? read(key) : undefined),
    set: (_t, key, value) => { if (typeof key === 'string') write(key, value as ParamValue); return true },
    has: (_t, key) => (typeof key === 'string' ? read(key) !== undefined : false),
  })
}
