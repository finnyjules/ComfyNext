/**
 * Postcondition verifier (F4). After the agent proposes a change we apply it and
 * run these deterministic checks against the *resulting* layout, so the failure
 * classes the agent can't see — text off the canvas, illegible contrast, a
 * headline too small to read — surface as warnings instead of reaching the user
 * unflagged. Pure: takes a template, returns issues. No model, no cost.
 */
import type { BrandKit, TemplateV3, TextElementV2 } from '~~/shared/template-grid/types'
import { allElements } from '~~/shared/template-grid/sections'
import { fineGridDims } from '~~/shared/template-grid/grid'
import { SWISS_LIMITS } from '~/lib/agent/designPrinciples'

export interface LayoutIssue {
  level: 'warn'
  target?: string
  message: string
}

type RGB = { r: number; g: number; b: number }

/** Parse #rgb / #rrggbb(aa) / rgb()/rgba() to RGB. null for gradients, named
 *  colours, tokens, or anything we can't reason about (we skip those). */
export function parseColor(input: string): RGB | null {
  const s = input.trim()
  if (s.startsWith('#')) {
    let hex = s.slice(1)
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
    if (hex.length !== 6 && hex.length !== 8) return null
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16)
    return [r, g, b].every(n => !Number.isNaN(n)) ? { r, g, b } : null
  }
  const m = /rgba?\(([^)]+)\)/i.exec(s)
  if (m) {
    const [r, g, b] = m[1]!.split(',').map(x => parseInt(x.trim(), 10))
    return [r, g, b].every(n => !Number.isNaN(n)) ? { r: r!, g: g!, b: b! } : null
  }
  return null
}

/** Resolve a {{ brand.X }} token to its kit value; pass anything else through. */
function resolveToken(v: string | undefined, brand?: BrandKit): string | undefined {
  if (!v) return v
  const m = /\{\{\s*brand\.([\w]+)\s*\}\}/.exec(v)
  if (m) return (brand as Record<string, string | undefined> | undefined)?.[m[1]!]
  return v
}

function luminance({ r, g, b }: RGB): number {
  const f = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const MIN_CONTRAST = 2.5          // lenient (WCAG large-text is 3.0) to avoid false alarms
const HEADLINE_MIN_WIDTH = 0.4    // display/headline should span ≥40% of grid width

export function verifySmartLayout(t: TemplateV3): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const masterFmt = t.formats[t.master]
  const { cols, rows } = masterFmt ? fineGridDims(t, masterFmt) : { cols: 0, rows: 0 }
  const brand = t.brand

  // The canvas backdrop, if it's a solid colour we can reason about. A gradient
  // or image background → null (skip contrast rather than guess). Default canvas
  // is dark (#000), matching the renderer.
  const bgFill = resolveToken(t.background?.fill, brand)
  const docBg: RGB | null = t.background?.image ? null : (bgFill ? parseColor(bgFill) : { r: 0, g: 0, b: 0 })

  for (const el of allElements(t)) {
    if (el.hidden) continue
    const r = el.region
    const label = el.role ?? el.type

    // Off-grid — bleed is an intentional edge extension and overhang is a
    // declared off-canvas placement (Task 10/2a-5), so skip both.
    if (cols > 0 && !el.bleed && !el.overhang) {
      if (r.col < 1 || r.row < 1 || r.col + r.colSpan - 1 > cols || r.row + r.rowSpan - 1 > rows) {
        issues.push({ level: 'warn', target: el.id, message: `${label} extends off-canvas (outside the ${cols}×${rows} grid)` })
      }
    }

    if (el.type === 'text') {
      // A prominent heading squeezed into a small width won't read as one.
      if ((el.level === 'display' || el.level === 'headline') && cols > 0 && r.colSpan < cols * HEADLINE_MIN_WIDTH) {
        issues.push({ level: 'warn', target: el.id, message: `${label} is narrow for a ${el.level} — widen it so it reads as a headline` })
      }
      // Contrast against its backdrop (a panel/scrim if present, else the canvas).
      const panelFill = el.style?.panel?.fill ? resolveToken(el.style.panel.fill, brand) : undefined
      const backdrop = (panelFill ? parseColor(panelFill) : null) ?? docBg
      const textColRaw = resolveToken(el.style?.color, brand) ?? resolveToken(brand?.foreground, brand) ?? '#ffffff'
      const textCol = parseColor(textColRaw)
      if (textCol && backdrop) {
        const ratio = contrastRatio(textCol, backdrop)
        if (ratio < MIN_CONTRAST) {
          issues.push({ level: 'warn', target: el.id, message: `${label} may be hard to read — low contrast (${ratio.toFixed(1)}:1) against the background` })
        }
      }
    }
  }

  // --- Swiss restraint (aggregate over the whole composition) ---
  const visible = allElements(t).filter(e => !e.hidden)
  const texts = visible.filter((e): e is TextElementV2 => e.type === 'text')

  // Palette restraint: count distinct solid colours in play (gradients/images skipped).
  const colours = new Set<string>()
  const addColour = (v?: string) => { const c = v ? parseColor(resolveToken(v, brand) ?? '') : null; if (c) colours.add(`${c.r},${c.g},${c.b}`) }
  addColour(t.background?.fill)
  for (const e of visible) {
    if (e.type === 'text') { addColour(e.style?.color); addColour(e.style?.panel?.fill) }
    else if (e.type === 'shape') { addColour(e.style?.fill); addColour(e.style?.borderColor) }
  }
  if (colours.size > SWISS_LIMITS.maxColours) {
    issues.push({ level: 'warn', message: `${colours.size} colours in use — Swiss style favours restraint (background + foreground + one accent)` })
  }

  // Type-scale restraint + clear hierarchy.
  const sizes = new Set(texts.map(e => String(e.style?.fontSize ?? e.level ?? 'body')))
  if (sizes.size > SWISS_LIMITS.maxTypeSizes) {
    issues.push({ level: 'warn', message: `${sizes.size} different text sizes — tighten to a small type scale` })
  }
  if (texts.length >= 2 && sizes.size === 1) {
    issues.push({ level: 'warn', message: 'no clear type hierarchy — make the headline distinctly larger than the body' })
  }

  // Composition: centring everything is the classic anti-Swiss tell.
  if (texts.length >= 2 && texts.every(e => e.style?.align === 'center')) {
    issues.push({ level: 'warn', message: 'everything is centred — Swiss style favours a flush-left, asymmetric composition' })
  }

  return issues
}
