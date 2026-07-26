import { describe, it, expect } from 'vitest'
import { animatableTargets } from '../../app/lib/gradientfx/motion'
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
