// frontend/tests/unit/shaderstudio-glsl.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { ADJUST_FS, CHROMATIC_FS, DUOTONE_FS, LENS_BLUR_FS } from '~/lib/shaderstudio/glsl'

const ALL = { DUOTONE_FS, ADJUST_FS, LENS_BLUR_FS, CHROMATIC_FS }

describe('shaderstudio glsl', () => {
  for (const [name, src] of Object.entries(ALL)) {
    it(`${name} satisfies the renderer contract and has no stray backtick`, () => {
      expect(src).toContain('#version 300 es')
      expect(src).toContain('uniform sampler2D u_image0;')
      expect(src).toContain('fragColor0')
      expect(src).toContain('void main')
      expect(src).not.toContain('`') // backtick would have broken the literal
    })
  }
})
