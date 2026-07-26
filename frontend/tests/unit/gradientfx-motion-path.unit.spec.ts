import { describe, it, expect } from 'vitest'
import { animatableTargets, applyMotion } from '../../app/lib/gradientfx/motion'
import { defaultConfig } from '../../app/lib/gradientfx/randomize'
import { ensureConfigDefaults } from '../../app/lib/gradientfx/types'
import { getByPath } from '../../app/lib/studio/path'

/**
 * Raw defaultConfig() leaves cfg.focus and layers[0].mesh undefined; the real
 * app always normalizes through ensureConfigDefaults on load (see
 * gradientfx-controls.unit.spec.ts's cfgWithLayout helper). Build every test
 * config the same way so focus.* and mesh.* paths actually resolve.
 */
const cfg = () => ensureConfigDefaults(defaultConfig() as any) as any

describe('animatableTargets', () => {
  it('returns absolute paths that resolve on the config', () => {
    const c = cfg()
    const targets = animatableTargets(c)
    expect(targets.length).toBeGreaterThan(0)
    for (const t of targets) {
      expect(getByPath(c, t.path), `${t.path} unresolved`).not.toBeUndefined()
    }
  })

  it('expands layer-relative controls once per layer', () => {
    const c = cfg()
    c.layers = [c.layers[0], JSON.parse(JSON.stringify(c.layers[0]))]
    const paths = animatableTargets(c).map((t) => t.path)
    const l0 = paths.filter((p) => p.startsWith('layers.0.'))
    const l1 = paths.filter((p) => p.startsWith('layers.1.'))
    expect(l0.length).toBeGreaterThan(0)
    expect(l1.length).toBe(l0.length)
  })

  it('every target has a finite range with max > min', () => {
    for (const t of animatableTargets(cfg())) {
      expect(Number.isFinite(t.min), `${t.path} min`).toBe(true)
      expect(Number.isFinite(t.max), `${t.path} max`).toBe(true)
      expect(t.max, `${t.path} range`).toBeGreaterThan(t.min)
    }
  })

  it('animates far more than the 11 legacy shape keys', () => {
    // The point of the refactor: relief, flow and focus params become
    // animatable for the first time.
    expect(animatableTargets(cfg()).length).toBeGreaterThan(11)
  })

  it('includes non-shape targets that were previously impossible', () => {
    const paths = animatableTargets(cfg()).map((t) => t.path)
    expect(paths).toContain('relief.grain')
    expect(paths).toContain('focus.blur')
  })

  it('uses the animatable range override where it differs from the UI slider', () => {
    const c = cfg()
    const sweep = animatableTargets(c).find((t) => t.path.endsWith('.shape.sweep'))
    expect(sweep).toBeDefined()
    expect(sweep!.min).toBe(0)
    expect(sweep!.max).toBe(360)
  })

  it('produces unique labels so the dropdown is unambiguous', () => {
    const labels = animatableTargets(cfg()).map((t) => t.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('excludes non-numeric controls', () => {
    const paths = animatableTargets(cfg()).map((t) => t.path)
    expect(paths).not.toContain('canvas.background')
    expect(paths).not.toContain('canvas.layout')
  })
})

const track = (over: any = {}) => ({
  path: 'layers.0.shape.count', from: 0, to: 10,
  easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0, ...over,
})

describe('path-based applyMotion', () => {
  it('writes the animated value at the track path', () => {
    const c: any = cfg()
    c.motion.duration = 1
    c.motion.tracks = [track()]
    expect((applyMotion(c, 1) as any).layers[0].shape.count).toBe(10)
  })

  it('does not mutate the input config', () => {
    const c: any = cfg()
    c.motion.duration = 1
    c.motion.tracks = [track()]
    const before = c.layers[0].shape.count
    applyMotion(c, 1)
    expect(c.layers[0].shape.count).toBe(before)
  })

  it('animates a non-shape path that was impossible before', () => {
    const c: any = cfg()
    c.motion.duration = 1
    c.motion.tracks = [track({ path: 'relief.grain', from: 0, to: 1 })]
    expect((applyMotion(c, 1) as any).relief.grain).toBe(1)
  })

  it('ignores an unresolvable path without fabricating structure', () => {
    const c: any = cfg()
    c.motion.duration = 1
    c.motion.tracks = [track({ path: 'nope.does.not.exist' })]
    expect((applyMotion(c, 1) as any).nope).toBeUndefined()
  })

  it('ignores a track with no path at all', () => {
    const c: any = cfg()
    c.motion.duration = 1
    c.motion.tracks = [track({ path: undefined })]
    expect(() => applyMotion(c, 1)).not.toThrow()
  })
})

describe('legacy track migration', () => {
  it('rewrites {layer, param} tracks to absolute paths', () => {
    const c: any = cfg()
    c.motion.tracks = [
      { layer: 0, param: 'count', from: 2, to: 8, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 },
      { layer: 1, param: 'phase', from: 0, to: 1, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 },
    ]
    const out: any = ensureConfigDefaults(c)
    expect(out.motion.tracks[0].path).toBe('layers.0.shape.count')
    expect(out.motion.tracks[1].path).toBe('layers.1.shape.phase')
  })

  it('leaves already-migrated tracks untouched', () => {
    const c: any = cfg()
    c.motion.tracks = [{ path: 'relief.grain', from: 0, to: 1, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 }]
    expect((ensureConfigDefaults(c) as any).motion.tracks[0].path).toBe('relief.grain')
  })

  it('a migrated legacy track still animates', () => {
    const c: any = cfg()
    c.motion.duration = 1
    c.motion.tracks = [{ layer: 0, param: 'count', from: 0, to: 10, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 }]
    expect((applyMotion(ensureConfigDefaults(c), 1) as any).layers[0].shape.count).toBe(10)
  })

  it('animates a legacy {layer, param} track with no migration step at all', () => {
    // Regression test for the CRITICAL finding: ensureConfigDefaults only runs
    // on the editor-open path. The node card, headless bake, and studio frame
    // source all render straight from the saved blob, so applyMotion itself
    // must tolerate un-migrated tracks.
    const c: any = cfg()
    c.motion.duration = 1
    c.motion.tracks = [{ layer: 0, param: 'count', from: 0, to: 10, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 }]
    expect((applyMotion(c, 1) as any).layers[0].shape.count).toBe(10)
  })
})

describe('applyMotion parent-container guard', () => {
  it('animates an optional-but-real leaf even when unset', () => {
    const c: any = cfg()
    c.motion.duration = 1
    delete c.flow.swirl
    c.motion.tracks = [track({ path: 'flow.swirl', from: 0, to: 50 })]
    expect((applyMotion(c, 1) as any).flow.swirl).toBe(50)
  })

  it('skips a path whose parent container does not exist, without throwing', () => {
    const c: any = cfg()
    c.motion.duration = 1
    c.layers = [c.layers[0]]
    c.motion.tracks = [track({ path: 'layers.5.shape.count' })]
    expect(() => applyMotion(c, 1)).not.toThrow()
    const out: any = applyMotion(c, 1)
    expect(out.layers[5]).toBeUndefined()
  })

  it('skips a completely bogus path', () => {
    const c: any = cfg()
    c.motion.duration = 1
    c.motion.tracks = [track({ path: 'nope.does.not.exist' })]
    const out: any = applyMotion(c, 1)
    expect(out.nope).toBeUndefined()
  })
})
