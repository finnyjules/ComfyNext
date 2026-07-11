/** {{ props.x }} / {{ brand.y }} interpolation — single implementation shared
 * by the render path, the resolver (copy fitting), and the editor. */

export type TokenScope = Record<string, unknown>

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g

export function resolveTokens<T>(value: T, props: TokenScope = {}, brand: TokenScope = {}): T {
  if (typeof value !== 'string') return value
  const lookup = (path: string): unknown => {
    const [scope, ...rest] = path.split('.')
    const root = scope === 'props' ? props : scope === 'brand' ? brand : undefined
    if (!root || !rest.length) return undefined
    // Flat-first: backend KV parsing produces flat dotted keys ('logos.mark').
    const flat = rest.join('.')
    if (flat in root) return root[flat]
    // Nested walk: editor-side scopes are real objects.
    let cur: unknown = root
    for (const seg of rest) {
      if (cur == null || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[seg]
    }
    return cur
  }
  const whole = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/)
  if (whole) {
    const v = lookup(whole[1])
    return (v ?? value) as unknown as T
  }
  return value.replace(TOKEN_RE, (_, path) => {
    const v = lookup(path)
    return v == null ? '' : String(v)
  }) as unknown as T
}
