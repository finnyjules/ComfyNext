import { describe, it, expect } from 'vitest'
import { visibleGradientControls } from '~/lib/gradientfx/controls'
import { defaultConfig } from '~/lib/gradientfx/randomize'
import { ensureConfigDefaults, LAYOUTS, type GradientConfig } from '~/lib/gradientfx/types'

describe('layer.layout control', () => {
  it('is present with all layouts as options', () => {
    const c = ensureConfigDefaults(defaultConfig('#pl1') as GradientConfig)
    const ctl = visibleGradientControls(c).find(k => k.key === 'layer.layout')
    expect(ctl).toBeTruthy()
    expect(ctl!.kind).toBe('select')
    expect((ctl as any).options).toEqual([...LAYOUTS])
  })
})
