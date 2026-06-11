import {
  createTextLayer, createRectLayer, createImageLayer, type LocalLayer,
} from '~/composables/useCompositorLayers'
import type { Gradient } from '~/composables/useCompositorLayers'
import { resolveTokens } from '~~/shared/template-grid/tokens'
import type { BrandKit } from '~~/shared/brand/types'
import type { FrameMotion } from '~/lib/motion/types'
import type {
  SlateTemplate, SlateLayerDef, SlatePaintDef, InstantiateOptions,
} from './types'

/** Token-resolve fallbacks: unresolved brand roles get visible neutrals so a
 *  kit-less instantiation still renders (resolveTokens returns the raw token
 *  for whole-string misses, which must never reach a canvas font/color). */
const NEUTRALS: Record<string, string> = {
  primary: '#111113', secondary: '#3f3f46', accent: '#a3e635', accent2: '#22d3ee',
  foreground: '#ffffff', background: '#0a0a0a', fontDisplay: 'Inter', fontBody: 'Inter',
}

function resolveStr(value: string, texts: Record<string, string>, brand: BrandKit): string {
  const out = String(resolveTokens(value, texts, brand as Record<string, unknown>))
  // resolveTokens returns the RAW token on a whole-string miss. Map an
  // unresolved brand role to a visible neutral; drop any other stray token
  // (e.g. a props.* typo in a template) to empty so `{{ }}` never reaches a
  // layer's font/color/text.
  const brandMiss = /^\{\{\s*brand\.(\w+)\s*\}\}$/.exec(out)
  if (brandMiss) return NEUTRALS[brandMiss[1]] ?? '#888888'
  if (/^\{\{\s*[\w.]+\s*\}\}$/.test(out)) return ''
  return out
}

function resolvePaint(p: SlatePaintDef, texts: Record<string, string>, brand: BrandKit): string | Gradient {
  if (typeof p === 'string') return resolveStr(p, texts, brand)
  return {
    type: p.type, angle: p.angle ?? 0,
    stops: p.stops.map(s => ({ offset: s.offset, color: resolveStr(s.color, texts, brand) })),
  } as Gradient
}

/** Resolve a template's 3 thumbnail token-colors against a brand kit (empty
 *  kit ⇒ neutrals), for the gallery card preview. */
export function resolveThumb(colors: [string, string, string], brand: BrandKit): string[] {
  return colors.map(c => resolveStr(c, {}, brand))
}

export function instantiateSlate(
  template: SlateTemplate,
  opts: InstantiateOptions,
): { layers: LocalLayer[]; motion: FrameMotion } {
  const texts: Record<string, string> = {}
  for (const slot of template.textSlots) texts[slot.key] = opts.texts[slot.key]?.trim() || slot.default
  const brand = opts.brand

  const idByRef = new Map<string, string>()
  const layers: LocalLayer[] = template.layers.map((def: SlateLayerDef) => {
    const common = {
      x: def.x, y: def.y, rotation: def.rotation ?? 0, opacity: def.opacity ?? 1,
      animation: def.animation ? structuredClone(def.animation) : undefined,
    }
    let layer: LocalLayer
    if (def.kind === 'text') {
      layer = createTextLayer({
        ...common,
        text: resolveStr(def.text, texts, brand),
        fontFamily: resolveStr(def.fontFamily, texts, brand),
        fontWeight: def.fontWeight,
        fontSize: def.fontSize,
        color: resolveStr(def.color, texts, brand),
        align: def.align ?? 'center',
        lineHeight: def.lineHeight ?? 1.1,
        strokeColor: def.strokeColor ? resolveStr(def.strokeColor, texts, brand) : '#000000',
        strokeWidth: def.strokeWidth ?? 0,
      })
    } else if (def.kind === 'rect') {
      layer = createRectLayer({
        ...common, w: def.w, h: def.h, radius: def.radius ?? 0,
        fill: resolvePaint(def.fill, texts, brand),
      })
    } else {
      const fill = opts.media?.[def.slot]
      layer = fill
        ? createImageLayer(fill.filename, fill.aspect, { ...common, w: def.w })
        : createRectLayer({ ...common, w: def.w, h: def.h, radius: 0, fill: resolvePaint(def.fallbackFill, texts, brand) })
    }
    idByRef.set(def.ref, layer.id)
    return layer
  })

  template.layers.forEach((def, i) => {
    if (def.maskedByRef) {
      const id = idByRef.get(def.maskedByRef)
      if (id) (layers[i] as { maskedById?: string }).maskedById = id
    }
  })

  return { layers, motion: { ...template.motion } }
}
