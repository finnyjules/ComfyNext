/** {{ props.x }} / {{ brand.y }} interpolation — single implementation shared
 * by the render path, the resolver (copy fitting), and the editor. */

export type TokenScope = Record<string, unknown>

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g

export function resolveTokens<T>(value: T, props: TokenScope = {}, brand: TokenScope = {}): T {
  if (typeof value !== 'string') return value
  const lookup = (path: string): unknown => {
    const [scope, key] = path.split('.')
    if (scope === 'props') return props[key]
    if (scope === 'brand') return brand[key]
    return undefined
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
