import { describe, expect, it } from 'vitest'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import { TEXTURE_SECTIONS } from '~/lib/texturefx/sections'

describe('texturefx controls', () => {
  it('defaults include every control key plus seed', () => {
    const d = textureDefaults()
    for (const c of TEXTURE_CONTROLS) expect(d[c.key]).toBe(c.default)
    expect(d.seed).toBe(1)
  })

  it('every control group is in the section allow-list', () => {
    const allowed = new Set<string>(TEXTURE_SECTIONS)
    for (const c of TEXTURE_CONTROLS) {
      expect(c.group, `control "${c.key}" has group "${c.group}"`).toBeDefined()
      expect(allowed.has(String(c.group)), `group "${c.group}" not in TEXTURE_SECTIONS`).toBe(true)
    }
  })

  it('select defaults are valid options', () => {
    for (const c of TEXTURE_CONTROLS) {
      if (c.kind === 'select') expect(c.options).toContain(c.default)
    }
  })
})
