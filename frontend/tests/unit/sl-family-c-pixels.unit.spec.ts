/**
 * FIX 6 (round-2b final fix wave) — Family C live verification.
 *
 * The E2E harness (tests/sl-generation.spec.ts) only ever wires a TEXT
 * socket into the SmartLayout node, so none of the "photo IS the
 * composition" Family C stagings (cover/lockup/band_header/band_footer)
 * have ever been proven against a real IMAGE, end to end. Chosen route (b)
 * from the two the fix wave offered — a vitest server test through the REAL
 * satori/resvg render path (`templateToSatori` → `satori` → `Resvg`, the
 * exact pipeline `server/api/render-template.post.ts` runs) with a
 * generated `cover` template and an inline data-URI "photo" — over route
 * (a) wiring an image socket into the Playwright E2E. Route (b) is chosen
 * because it proves the same claim (full-bleed photo BEHIND the text,
 * hero legible ON TOP, in real rasterised pixels) without a browser, a dev
 * server, or the flakiness of a real pointer-drag wire — and this exact
 * satori+resvg pipeline already has precedent in this repo (see
 * tests/unit/vectortype-color-tracks.unit.spec.ts's "REAL PIXELS" section)
 * for asserting rendered output rather than trusting "it composed without
 * throwing".
 *
 * Two claims, both read straight off decoded PNG pixels:
 *  1. A CORNER pixel — nowhere near any placed text — is the PHOTO's own
 *     colour, not the theme's field colour. Proves the full-bleed `img_0`
 *     genuinely painted (not silently dropped/skipped).
 *  2. The row crossing the hero's vertical centre differs between the real
 *     render and an otherwise-identical "photo only" render (every text
 *     element hidden). Proves the hero text is really painted ON TOP of
 *     the photo (z-order), not absent/culled/hidden behind it.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'
import sharp from 'sharp'
import { describe, expect, it, beforeAll } from 'vitest'
import { generate } from '~~/shared/template-grid/generate/generate'
import { makeStarterTemplate } from '~~/shared/template-grid/starter'
import { templateToSatori } from '~~/server/templates/translate'
import type { TemplateV3, Tiers } from '~~/shared/template-grid/types'

const IMAGE_PROP = 'image_layer_1'
const IMAGE_TOKEN = `{{ props.${IMAGE_PROP} }}`
// A saturated, distinctive green nowhere near `paper` theme's field/ink
// (near-white/near-black) or `red` theme's accent — chosen so a
// within-tolerance pixel match is unambiguous evidence of the PHOTO, not a
// coincidental theme colour.
const PHOTO_RGB = { r: 20, g: 180, b: 90 }

const TIERS: Tiers = {
  hero: [{ content: 'MAT + FEST' }],
  anchor: [{ content: '15—26 June' }],
  support: [{ content: 'Street food' }],
  fineprint: [{ content: 'Slakthus' }],
}

let fonts: { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }[]
let photoDataUri: string

beforeAll(async () => {
  const toArrayBuffer = (buf: Buffer): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const [reg, bold] = await Promise.all([
    readFile(join(process.cwd(), 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff')),
    readFile(join(process.cwd(), 'node_modules/@fontsource/inter/files/inter-latin-700-normal.woff')),
  ])
  fonts = [
    { name: 'Inter', data: toArrayBuffer(reg), weight: 400, style: 'normal' },
    { name: 'Inter', data: toArrayBuffer(bold), weight: 700, style: 'normal' },
  ]
  const png = await sharp({
    create: { width: 200, height: 200, channels: 4, background: { ...PHOTO_RGB, alpha: 1 } },
  }).png().toBuffer()
  photoDataUri = `data:image/png;base64,${png.toString('base64')}`
})

/** A real `cover` (Family C, full-bleed photo overprint) generation on the
 *  production starter master (1080x1080, `fineGridDims` → 78x78) — the
 *  exact promotion path `SmartLayoutEditorModal` uses on a fresh open. */
function coverTemplate(): TemplateV3 {
  const starter = makeStarterTemplate('t') as any
  starter.tiers = TIERS
  const v3ified: TemplateV3 = { ...starter, version: 3, sections: [] }
  return generate(v3ified, { staging: 'cover', theme: 'paper', seed: 1, image: IMAGE_TOKEN })
}

interface Rendered { width: number; height: number; pixels: Uint8Array }

/** Real satori → resvg render — the identical pipeline render-template.
 *  post.ts runs, minus the Google/uploaded/library font tiers (Inter alone
 *  covers this fixture's content). A data: URI src needs no network fetch
 *  (inlineTreeImages only rewrites http(s) sources), so this stays 100%
 *  offline. */
async function render(t: TemplateV3, props: Record<string, string>): Promise<Rendered> {
  const { tree, width, height } = templateToSatori(t, t.master, props, t.brand ?? {})
  const svg = await satori(tree as any, { width, height, fonts })
  const img = new Resvg(svg, { fitTo: { mode: 'original' } }).render()
  return { width: img.width, height: img.height, pixels: img.pixels }
}

function pixelAt(r: Rendered, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const i = (y * r.width + x) * 4
  return { r: r.pixels[i]!, g: r.pixels[i + 1]!, b: r.pixels[i + 2]!, a: r.pixels[i + 3]! }
}

function closeTo(a: number, b: number, tol = 12): boolean {
  return Math.abs(a - b) <= tol
}

describe('FIX 6 (Family C live verification, route b): cover staging renders real photo+text pixels', () => {
  it('a corner pixel — far from every placed text element — is the PHOTO colour, not the theme field', async () => {
    const t = coverTemplate()
    const rendered = await render(t, { [IMAGE_PROP]: photoDataUri })
    // Bottom-left corner, inset a few px past the antialiased edge fringe.
    // `cover`'s text lives in the vertical band [0.36..0.60] mid-canvas plus
    // top corners for fine print (round-2b Family C table) — the bottom-left
    // corner is clear of all of it.
    const px = pixelAt(rendered, 6, rendered.height - 7)
    expect(px.a, 'corner pixel must be opaque').toBe(255)
    expect(closeTo(px.r, PHOTO_RGB.r)).toBe(true)
    expect(closeTo(px.g, PHOTO_RGB.g)).toBe(true)
    expect(closeTo(px.b, PHOTO_RGB.b)).toBe(true)

    // NEGATIVE CONTROL: the theme's own field colour (paper: #f2f0ef, a
    // near-white) must NOT be what's actually there — proves the assertion
    // above is discriminating, not vacuously true for any opaque pixel.
    expect(closeTo(px.r, 0xf2, 12) && closeTo(px.g, 0xf0, 12) && closeTo(px.b, 0xef, 12)).toBe(false)
  })

  it('the hero-centre row differs from a photo-only render — the hero text is really painted on top', async () => {
    const t = coverTemplate()
    const withText = await render(t, { [IMAGE_PROP]: photoDataUri })

    // Same template, same photo — every TEXT element hidden. Only the
    // full-bleed `img_0` (+ any background shape) remains.
    const photoOnly: TemplateV3 = { ...t, elements: t.elements.map(e => (e.type === 'text' ? { ...e, hidden: true } : e)) }
    const noText = await render(photoOnly, { [IMAGE_PROP]: photoDataUri })
    expect(withText.width).toBe(noText.width)
    expect(withText.height).toBe(noText.height)

    // cover's hero sits at rowBand(0.36, 0.60) of the grid, vertically
    // centred within that band — 0.48 of the canvas height is inside it
    // regardless of exact grid rounding.
    const y = Math.round(0.48 * withText.height)
    let differingPixels = 0
    for (let x = 0; x < withText.width; x += 2) {
      const a = pixelAt(withText, x, y)
      const b = pixelAt(noText, x, y)
      if (!closeTo(a.r, b.r, 4) || !closeTo(a.g, b.g, 4) || !closeTo(a.b, b.b, 4)) differingPixels++
    }
    // A real headline paints many pixels across that row, not one stray AA
    // pixel — require a real quantity of difference, not just >0.
    expect(differingPixels).toBeGreaterThan(10)
  })
})
