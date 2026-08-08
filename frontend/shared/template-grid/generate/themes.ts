/**
 * Smart Layout Round 2 — Theme model (replaces the surface axis)
 *
 * A theme is a colour system: field (background), ink (resolved by luminance),
 * and accent. No external imports — pure module.
 */

export interface Theme {
  id: string
  name: string
  field: string
  defaultAccent: string
}

export const THEMES: Theme[] = [
  { id: 'black', name: 'Black', field: '#000000', defaultAccent: '#dd2200' },
  { id: 'white', name: 'White', field: '#ffffff', defaultAccent: '#dd2200' },
  { id: 'paper', name: 'Paper', field: '#f2f0ef', defaultAccent: '#dd2200' },
  { id: 'red', name: 'Red', field: '#dd2200', defaultAccent: '#f2f0ef' },
  { id: 'orange', name: 'Orange', field: '#fc461f', defaultAccent: '#000000' },
  { id: 'green', name: 'Green', field: '#2e6f40', defaultAccent: '#f2f0ef' },
  { id: 'blue', name: 'Blue', field: '#1d4ed8', defaultAccent: '#f2f0ef' },
]

export const THEME_PALETTE: string[] = THEMES.map(t => t.field)

export function getTheme(id: string): Theme | undefined {
  return THEMES.find(t => t.id === id)
}

/**
 * WCAG 2.x Relative Luminance
 * https://www.w3.org/TR/WCAG20/#relativeluminancedef
 *
 * Supports #rgb and #rrggbb hex format (case-insensitive).
 * Returns a value in [0, 1].
 */
export function relLuminance(hex: string): number {
  // Normalize: remove # and convert to lowercase
  const clean = hex.toLowerCase().replace('#', '')

  // Parse hex: support both #rgb and #rrggbb
  let r: number, g: number, b: number
  if (clean.length === 3) {
    // #rgb → expand to #rrggbb
    r = parseInt(clean[0] + clean[0], 16) / 255
    g = parseInt(clean[1] + clean[1], 16) / 255
    b = parseInt(clean[2] + clean[2], 16) / 255
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16) / 255
    g = parseInt(clean.slice(2, 4), 16) / 255
    b = parseInt(clean.slice(4, 6), 16) / 255
  } else {
    throw new Error(`Invalid hex color: ${hex}`)
  }

  // sRGB linearization
  const linearize = (c: number): number => {
    if (c <= 0.03928) {
      return c / 12.92
    } else {
      return ((c + 0.055) / 1.055) ** 2.4
    }
  }

  const rLinear = linearize(r)
  const gLinear = linearize(g)
  const bLinear = linearize(b)

  // Weighted sum (WCAG coefficients)
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear
}

/**
 * Resolves ink colour for a field by luminance contrast.
 * Light fields get dark ink (#111111), dark fields get light ink (#f2f0ef).
 * Threshold: relLuminance > 0.45 → dark ink; else light ink.
 */
export function resolveInk(field: string): string {
  const lum = relLuminance(field)
  return lum > 0.45 ? '#111111' : '#f2f0ef'
}

/**
 * WCAG contrast ratio between two colors.
 * Formula: (L_max + 0.05) / (L_min + 0.05)
 * Returns a value in [1, 21].
 */
export function contrastRatio(a: string, b: string): number {
  const lumA = relLuminance(a)
  const lumB = relLuminance(b)

  const lMax = Math.max(lumA, lumB)
  const lMin = Math.min(lumA, lumB)

  return (lMax + 0.05) / (lMin + 0.05)
}

/**
 * Migration map: round-1 surface ids → round-2 theme ids.
 * Used at load/generate choke points for schema migration.
 */
export const SURFACE_TO_THEME: Record<string, string> = {
  flat: 'paper',
  holographic: 'paper',
  tint: 'red',
  'split-field': 'black',
  'duotone-photo': 'black',
}
