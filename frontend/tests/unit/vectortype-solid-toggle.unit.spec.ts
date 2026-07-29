/**
 * Vector Type — `solid` as a STACK ROW, and the backfilled width it must not
 * turn into a keyline.
 *
 * Everything Tasks 1 and 2 built is gated on `layer.solid`, and `solid` had no
 * UI, so none of it was reachable. This is the toggle that reaches it — and the
 * reason it is a row beside the eye rather than a control in the inspector is a
 * failure mode worth demonstrating rather than describing:
 *
 *   > `ControlSpec` has no boolean kind. The house workaround is a `select` over
 *   > `['off','on']`, which works in Space Type because its params are strings.
 *   > Here `mergeLayer` reads `typeof o.solid === 'boolean'`, so a select would
 *   > store `'on'`, the merge would DROP it, and the user would get a toggle that
 *   > works until they reopen the file.
 *
 * So §1 pins both halves: a real boolean survives two merges, and the string a
 * select would have written does not survive one.
 *
 * §2 is about the seam. `StudioLayerStack` is shared with Gradient and Shader and
 * was not forked: it gained one anonymous scoped slot (`row-extra`) that knows
 * nothing about Vector Type, and the two other consumers fill it with nothing.
 *
 * §3 is the decision Task 2's §9.2 handed forward. Every extrude layer stored
 * before the silhouette carries a BACKFILLED `width: 3` — the field was inert and
 * its only control was gated to stroke layers, so no user ever authored one. Left
 * alone, the first thing this toggle would do to such a layer is grow a 3 px black
 * outline nobody asked for. The fix is in `mergeLayer` and it must itself survive
 * a reload, which is what the double-merge assertions are for.
 *
 * NO NETWORK, NO DOM beyond a recording 2D context. paper.js runs headless where
 * a real body is needed.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import { describe, expect, it } from 'vitest'
import type { VectorCommand } from '~/lib/vector/svg'
import { normaliseAxes, type VtFont } from '~/lib/vectortype/font'
import {
  DEFAULT_CONFIG,
  VT_DEFAULT_EXTRUDE_STROKE_WIDTH,
  VT_DEFAULT_STROKE_WIDTH,
  mergeConfig,
  vtLayer,
  type VectorTypeConfig,
} from '~/lib/vectortype/config'
import { VT_CONTROLS, visibleVtControls } from '~/lib/vectortype/controls'
import { vtAgentControls } from '~/lib/vectortype/agentControls'
import { solidExtrudeBodyCached } from '~/lib/vectortype/extrudeSolid'
import {
  drawVectorType,
  vectorTypeFrame,
  vtPlacement,
  vtSolidExtrudeLayers,
} from '~/lib/vectortype/canvas'
import { glyphTransform as glyphPlacement, placeOutlines } from '~/lib/vectortype/render'

// ── sources, read as text ───────────────────────────────────────────────────
// The house pattern for a UI claim in this suite (`capsule-meta` does the same):
// the unit runner is `environment: 'node'` with no Vue plugin, so a component's
// STRUCTURE is asserted against its source. Live behaviour is verified in the
// running app and reported separately — these guard the seam from drifting back.

const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const STACK_SRC = src('../../app/components/vue-canvas/StudioLayerStack.vue')
const VT_SRC = src('../../app/components/vue-canvas/VectorTypeSurface.vue')
const GRADIENT_SRC = src('../../app/components/vue-canvas/GradientStudioSurface.vue')
const SHADER_SRC = src('../../app/components/vue-canvas/ShaderStudioSurface.vue')

// ── font + draw harness ─────────────────────────────────────────────────────

const FIXTURE = fileURLToPath(new URL('../fixtures/inter-subset-var.ttf', import.meta.url))

function loadFixtureFont(): VtFont {
  const bytes = new Uint8Array(readFileSync(FIXTURE))
  const raw: any = (fontkit as any).create(bytes)
  return {
    id: 'inter-subset',
    axes: normaliseAxes(raw?.variationAxes),
    unitsPerEm: Number(raw?.unitsPerEm) || 1000,
    raw,
  }
}
const font = loadFixtureFont()
const WORD = 'Sail'
const N = WORD.length
const BOX = { width: 400, height: 200 }

/** An identity `DOMMatrix` stand-in that CHAINS — the anchored paint path composes
 *  matrices, so a plain literal is not enough. */
class RecMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  inverse() { return new RecMatrix() }
  multiply() { return new RecMatrix() }
  translate() { return new RecMatrix() }
  scale() { return new RecMatrix() }
}

/** A recording 2D context that keeps FILLS AND STROKES APART. Counting "paints"
 *  cannot tell an outline from a fill, which is the whole question here. */
class RecCtx {
  ops: Array<{ op: 'fill' | 'stroke'; style: any; lineWidth: number }> = []
  canvas = { width: 800, height: 400 }
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  filter = 'none'
  fillStyle: any = '#000'
  strokeStyle: any = '#000'
  lineWidth = 1
  lineJoin = 'miter'
  save() {}
  restore() {}
  beginPath() {}
  clip() {}
  rect() {}
  translate() {}
  rotate() {}
  scale() {}
  setTransform() {}
  getTransform() { return new RecMatrix() }
  clearRect() {}
  fillRect() {}
  createLinearGradient() { return { addColorStop() {} } }
  createRadialGradient() { return { addColorStop() {} } }
  createPattern() { return null }
  fill() { this.ops.push({ op: 'fill', style: this.fillStyle, lineWidth: this.lineWidth }) }
  stroke() { this.ops.push({ op: 'stroke', style: this.strokeStyle, lineWidth: this.lineWidth }) }
  measureText() { return { width: 0 } }
}

class RecPath2D {
  __cmds: unknown[] = []
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  closePath() {}
  addPath() {}
}
;(globalThis as any).Path2D = RecPath2D

function draw(c: VectorTypeConfig) {
  const ctx = new RecCtx()
  drawVectorType(ctx as unknown as CanvasRenderingContext2D, font, c, 0, { ...BOX } as any)
  return ctx
}
const strokes = (ctx: RecCtx) => ctx.ops.filter(o => o.op === 'stroke')

/** Unite every glyph of `c`'s solid extrude and leave the bodies in the cache —
 *  the state the surface's debounced watcher produces a moment after an edit.
 *  Without this a solid extrude draws its copies and strokes nothing, so a
 *  keyline test that skipped it would pass for the wrong reason. */
async function warm(c: VectorTypeConfig): Promise<void> {
  const frame = vectorTypeFrame(font, c, 0)
  const place = vtPlacement(frame, BOX)
  const placed = placeOutlines(frame.outlines, place)
  const L = vtSolidExtrudeLayers(frame.config, frame.outlines.glyphs.length)[0]
  for (let i = 0; i < N; i++) {
    await solidExtrudeBodyCached(
      placed[i] as VectorCommand[],
      L?.copies ?? [],
      glyphPlacement(frame.outlines.glyphs[i]!, place),
      frame.outlines.glyphs[i]!.advance * place.scale,
    )
  }
}

/** A config as it comes OUT OF STORAGE — a plain JSON blob, merged, never built
 *  by `vtLayer` (which would helpfully add every field the question is about). */
function stored(...layers: Record<string, unknown>[]): VectorTypeConfig {
  return mergeConfig({ ...DEFAULT_CONFIG, text: WORD, size: 100, appearance: layers })
}
/** One round-trip through storage: serialise exactly as `saveConfig` does. */
const reload = (c: VectorTypeConfig): VectorTypeConfig => mergeConfig(JSON.parse(JSON.stringify(c)))

/** A stored extrude from BEFORE the silhouette: a backfilled width, no
 *  `strokeColor`, and `solid` written as the boolean `mergeLayer` emitted. */
const legacyExtrude = () => ({
  id: 'Lex', kind: 'extrude', enabled: true, paint: { type: 'solid', a: '#0044ff' },
  anchor: 'glyph', opacity: 1, blend: 'normal',
  width: VT_DEFAULT_STROKE_WIDTH, depth: 6, angle: 45, distance: 5, taper: 0, solid: false,
})

// ════════════════════════════════════════════════════════════════════════════

describe('`solid` is a real boolean, which is why it is a row and not a control', () => {
  it('round-trips TRUE through two reloads', () => {
    const once = stored({ ...legacyExtrude(), solid: true })
    expect(once.appearance[0]!.solid).toBe(true)
    const twice = reload(once)
    expect(twice.appearance[0]!.solid).toBe(true)
    // A boolean, not a truthy string — the renderer reads `l.solid === true`.
    expect(typeof twice.appearance[0]!.solid).toBe('boolean')
  })

  it('DROPS the string a `select` over [off, on] would have stored — the trap, demonstrated', () => {
    // This is what shipping `layer.solid` as a select looks like on the next
    // load: the panel wrote 'on', the merge cannot see a boolean, and the layer
    // comes back unfused. The toggle would have appeared to work all session.
    const c = stored({ ...legacyExtrude(), solid: 'on' })
    expect(c.appearance[0]!.solid).toBe(false)
    // …and 'true' as a string is no better, which is the same failure with a
    // different spelling of the option value.
    expect(stored({ ...legacyExtrude(), solid: 'true' }).appearance[0]!.solid).toBe(false)
  })

  it('is NOT declared as a control — not in the panel, not in the agent vocabulary', () => {
    const c = stored({ ...legacyExtrude(), solid: true })
    expect(VT_CONTROLS.some(k => k.key === 'layer.solid')).toBe(false)
    expect(visibleVtControls(c, 0).some(k => k.key === 'layer.solid')).toBe(false)
    expect(vtAgentControls(c, [], 0).some(k => k.key === 'layer.solid')).toBe(false)
    // And nobody smuggled it in under another name, as the `select` the trap
    // describes or anything else.
    expect(VT_CONTROLS.filter(k => k.key.endsWith('.solid'))).toEqual([])
  })

  it('unlocks the two silhouette controls, which is the whole point of the toggle', () => {
    const off = stored(legacyExtrude())
    const on = stored({ ...legacyExtrude(), solid: true })
    const keys = (c: VectorTypeConfig) => visibleVtControls(c, 0).map(k => k.key)
    expect(keys(off)).not.toContain('layer.width')
    expect(keys(off)).not.toContain('layer.strokeColor')
    expect(keys(on)).toContain('layer.width')
    expect(keys(on)).toContain('layer.strokeColor')
  })
})

describe('the toggle is a stack row, and the shared component was not forked', () => {
  it('adds exactly ONE seam to StudioLayerStack — an anonymous `row-extra` slot', () => {
    expect(STACK_SRC).toContain('<slot name="row-extra" :index="i" />')
    // One slot, not a family of them.
    expect(STACK_SRC.match(/<slot\b/g) ?? []).toHaveLength(1)
  })

  it('taught StudioLayerStack NOTHING about Vector Type — no import, no prop, no emit', () => {
    // The seam carries an INDEX and nothing else, so the shared component never
    // learns what the consumer's second boolean is called or which rows have one.
    expect(STACK_SRC).not.toMatch(/from '~\/lib\/vectortype/)
    expect(STACK_SRC).not.toMatch(/<slot name="row-extra"[^>]*:(?!index=")/)
    // The prop and emit surfaces Gradient and Shader pass are untouched, so
    // neither has to start supplying a field it does not have.
    expect(STACK_SRC).toContain('layers: { label: string; enabled: boolean; thumb?: string }[]')
    expect(STACK_SRC).toContain('add: []; remove: [i: number]; duplicate: [i: number]; toggle: [i: number]')
  })

  it('leaves Gradient and Shader filling the slot with nothing', () => {
    expect(GRADIENT_SRC).not.toContain('row-extra')
    expect(SHADER_SRC).not.toContain('row-extra')
    // Both still mount it as a self-closing element with NO children at all —
    // there is not even a closing tag — so their rows render the markup they
    // rendered before, element for element.
    expect(GRADIENT_SRC).not.toContain('</StudioLayerStack>')
    expect(SHADER_SRC).not.toContain('</StudioLayerStack>')
  })

  it('renders the toggle on EXTRUDE rows only, and writes a real boolean', () => {
    expect(VT_SRC).toContain('<template #row-extra="{ index }">')
    // The gate, on the element itself: a fill or a stroke has no copies to unite.
    expect(VT_SRC).toContain(`v-if="config.appearance[index]?.kind === 'extrude'"`)
    expect(VT_SRC).toContain('@click.stop="toggleSolid(index)"')
    // The handler flips a boolean and re-checks the kind — the button is not the
    // only thing standing between a fill layer and a meaningless `solid`.
    expect(VT_SRC).toMatch(/function toggleSolid\(i: number\) \{[\s\S]*?L\.kind !== 'extrude'[\s\S]*?L\.solid = L\.solid !== true/)
    // Never a select, and never a `ControlSpec` — the trap, guarded at the one
    // site that could still fall into it.
    expect(VT_SRC).not.toMatch(/StudioSelect[^>]*solid/i)
    expect(VT_SRC).not.toMatch(/key:\s*'layer\.solid'/)
  })
})

describe('the backfilled `width: 3` does not become an unrequested keyline', () => {
  it('normalises a PRE-SILHOUETTE extrude width to the extrude default', () => {
    const c = stored(legacyExtrude())
    expect(c.appearance[0]!.width).toBe(VT_DEFAULT_EXTRUDE_STROKE_WIDTH)
    expect(VT_DEFAULT_EXTRUDE_STROKE_WIDTH).toBe(0)
  })

  it('…and the normalisation itself SURVIVES A RELOAD — twice, and after the toggle', () => {
    // The failure this guards against is the fix forgetting on reload, which is
    // the same bug one level out from the one the schema was avoiding.
    const once = stored(legacyExtrude())
    expect(reload(once).appearance[0]!.width).toBe(0)
    expect(reload(reload(once)).appearance[0]!.width).toBe(0)
    // Now the user turns the toggle on and saves, which is the moment the width
    // becomes live. It is still 0, so still no keyline.
    const fused = reload(once)
    fused.appearance[0]!.solid = true
    const after = reload(fused)
    expect(after.appearance[0]!.solid).toBe(true)
    expect(after.appearance[0]!.width).toBe(0)
  })

  it('never touches a width the user AUTHORED — through any number of reloads, and an off/on cycle', () => {
    // A layer saved by this app since the silhouette landed always carries
    // `strokeColor`, which is what stops the normalisation ever seeing it again.
    const authored = reload(stored(legacyExtrude()))
    authored.appearance[0]!.solid = true
    authored.appearance[0]!.width = 8
    authored.appearance[0]!.strokeColor = '#ff0000'

    let c = reload(authored)
    expect(c.appearance[0]!.width).toBe(8)
    // Toggle OFF, save, reload — a rule keyed on `solid` alone would zero it here.
    c.appearance[0]!.solid = false
    c = reload(c)
    expect(c.appearance[0]!.width).toBe(8)
    // …and back ON, with the outline intact.
    c.appearance[0]!.solid = true
    c = reload(reload(c))
    expect(c.appearance[0]!.width).toBe(8)
    expect(c.appearance[0]!.strokeColor).toBe('#ff0000')
  })

  it('leaves a STROKE layer’s width alone — it was never inert there', () => {
    const c = stored({
      id: 'Lst', kind: 'stroke', paint: { type: 'solid', a: '#000000' }, width: VT_DEFAULT_STROKE_WIDTH,
    })
    expect(c.appearance[0]!.width).toBe(VT_DEFAULT_STROKE_WIDTH)
    expect(VT_DEFAULT_STROKE_WIDTH).toBe(3)
    // Including one with no width at all, which must still be visible.
    expect(stored({ id: 'Lst', kind: 'stroke' }).appearance[0]!.width).toBe(3)
  })

  it('leaves a HAND-WRITTEN fused extrude alone — the agent and settings-JSON path', () => {
    // Before this toggle existed, the only way to fuse an extrude was to write
    // the config by hand (which is how the silhouette was verified). Such a blob
    // has no `strokeColor` and a width that CAN paint; zeroing it would break the
    // one authoring path that already worked.
    const c = stored({ ...legacyExtrude(), solid: true, width: 6 })
    expect(c.appearance[0]!.width).toBe(6)
  })

  it('is a NO-OP on the picture at the moment it runs — a non-solid extrude strokes nothing either way', () => {
    const normalised = stored(legacyExtrude())
    const asStored = stored({ ...legacyExtrude(), strokeColor: '#ff0000' })
    expect(normalised.appearance[0]!.width).toBe(0)
    expect(asStored.appearance[0]!.width).toBe(3)
    // Different widths, identical frames: with `solid: false` the width is not
    // readable by anything that paints.
    expect(strokes(draw(normalised))).toHaveLength(0)
    expect(strokes(draw(asStored))).toHaveLength(0)
    expect(draw(normalised).ops).toHaveLength(draw(asStored).ops.length)
  })

  it('IS the keyline, on the real renderer — the control that shows what was avoided', async () => {
    // The same stored layer, opened and then FUSED BY THE TOGGLE — which is the
    // real sequence, and the only one in which the backfill can surface. The
    // control is the same blob with the normalisation disarmed (a stored
    // `strokeColor`, i.e. a layer from after the silhouette landed).
    const migrated = stored(legacyExtrude())
    migrated.appearance[0]!.solid = true
    const unmigrated = stored({ ...legacyExtrude(), strokeColor: '#000000' })
    unmigrated.appearance[0]!.solid = true
    await warm(migrated)
    await warm(unmigrated)

    const control = strokes(draw(unmigrated))
    expect(control).toHaveLength(N)                        // one black keyline per glyph…
    expect(control.every(o => o.style === '#000000' && o.lineWidth === 3)).toBe(true)
    expect(strokes(draw(migrated))).toHaveLength(0)        // …and none after the fix.
  })
})
