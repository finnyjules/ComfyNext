/**
 * TEMPORARY SPIKE — variable-font outline access via fontkit.
 *
 * Question: can we get a glyph OUTLINE at an arbitrary variable-axis position?
 * three's vendored opentype parses `fvar` but has no `gvar` parser, so it can
 * name the axes and never apply them. fontkit reads both, and depends on
 * `brotli`, so it should also decode the woff2 that Google serves variable
 * fonts as (the curl-UA trick only ever yields static per-weight TTF cuts).
 *
 * Delete this file once the finding is recorded.
 */
import * as fontkit from 'fontkit'

export interface SpikeResult {
  ok: boolean
  note: string
  bytes?: number
  isVariable?: boolean
  axes?: Record<string, { min: number; default: number; max: number }>
  namedInstances?: string[]
  /** Ink-area proxy per axis position, to prove the outline actually changes. */
  weightSweep?: { wght: number; bboxArea: number; commands: number }[]
  sampleGlyphPath?: string
}

/** Fetch a font as bytes. Google serves woff2 to a browser UA — which is the
 *  only form the VARIABLE file is available in. */
async function fetchFont(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`font fetch ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function runSpike(url: string, sampleChar = 'g'): Promise<SpikeResult> {
  try {
    const bytes = await fetchFont(url)
    // fontkit's browser build takes a Uint8Array/Buffer-like.
    const font: any = (fontkit as any).create(bytes)

    const axes = font.variationAxes ?? null
    const isVariable = !!axes && Object.keys(axes).length > 0
    if (!isVariable) {
      return { ok: false, note: 'parsed, but no variation axes — this is a static cut', bytes: bytes.length }
    }

    const wghtAxis = axes.wght
    const sweep: SpikeResult['weightSweep'] = []
    let samplePath = ''

    if (wghtAxis) {
      const stops = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(wghtAxis.min + (wghtAxis.max - wghtAxis.min) * t))
      for (const w of stops) {
        const inst: any = font.getVariation({ wght: w })
        const glyph: any = inst.glyphsForString(sampleChar)[0]
        const bb = glyph.bbox
        sweep.push({
          wght: w,
          bboxArea: Math.round((bb.maxX - bb.minX) * (bb.maxY - bb.minY)),
          commands: glyph.path.commands.length,
        })
        if (w === stops[2]) samplePath = String(glyph.path.toSVG()).slice(0, 120)
      }
    }

    return {
      ok: true,
      note: 'variable font parsed; outlines produced per axis position',
      bytes: bytes.length,
      isVariable,
      axes: Object.fromEntries(Object.entries(axes).map(([k, v]: [string, any]) =>
        [k, { min: v.min, default: v.default, max: v.max }])),
      namedInstances: Object.keys(font.namedVariations ?? {}).slice(0, 8),
      weightSweep: sweep,
      sampleGlyphPath: samplePath,
    }
  } catch (e: any) {
    return { ok: false, note: 'ERR: ' + (e?.message ?? String(e)) }
  }
}
