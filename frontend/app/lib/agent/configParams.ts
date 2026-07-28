import type { Params, ParamValue } from '~/lib/spacetype/effect'

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
 */
type AnyObj = Record<string, unknown>

export function makeConfigParams(
  root: () => unknown,
  activeLayer: () => number = () => 0,
  listKey = 'layers',
): Params {
  function base(key: string): { obj: AnyObj | null; parts: string[] } {
    const parts = key.split('.')
    let obj = root() as AnyObj | null
    if (parts[0] === 'layer') {
      const layers = (obj as AnyObj | null)?.[listKey] as AnyObj[] | undefined
      obj = layers?.[activeLayer()] ?? null
      parts.shift()
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
