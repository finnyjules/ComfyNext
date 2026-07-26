/**
 * Shared dotted-path traversal for studio configs.
 *
 * Unlike the older copy in shaderstudio/motion.ts, this one is array-aware: when
 * creating a missing intermediate it looks at the NEXT segment and creates an
 * array if that segment is a numeric index. Gradient's deepest paths
 * (`layers.0.color.stops.0.color`) cross two array boundaries, and an object
 * where an array is expected breaks renderers silently.
 */

const isIndex = (k: string): boolean => /^\d+$/.test(k)

export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined
  return path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj)
}

export function setByPath(obj: unknown, path: string, value: unknown): void {
  if (!path) return
  const keys = path.split('.')
  let o: any = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    if (o[k] == null || typeof o[k] !== 'object') {
      o[k] = isIndex(keys[i + 1]!) ? [] : {}
    }
    o = o[k]
  }
  o[keys[keys.length - 1]!] = value
}
