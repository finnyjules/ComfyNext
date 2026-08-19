// texOptsFromState must resolve fonts and casing the way the Expressive Studio
// modal's own texOpts() does — the card preview, the headless frame source
// (wired Compositor), and the timeline clip renderer all build their text
// atlases from THIS function, and it silently fell back to VARIABLE_FONTS[0]
// (Inter) for any font the legacy list didn't know (every plain Google family
// the FontPicker emits, e.g. 'Satisfy'), and force-uppercased effects whose
// textCase control defaults to 'asis'. Modal correct, canvas wrong — the
// render-parity drift class (see smart-layout-render-parity).
import { describe, it, expect, beforeEach } from 'vitest'
import { texOptsFromState, defaultSpaceTypeState } from '~/lib/spacetype/state'
import { setFontCatalog } from '~/lib/font/resolveFamily'

function stateFor(effectId: string, params: Record<string, unknown>) {
  const s = defaultSpaceTypeState()
  s.effectId = effectId
  Object.assign(s.params, params)
  return s
}

describe('texOptsFromState — modal parity', () => {
  beforeEach(() => setFontCatalog(null))

  it('passes an arbitrary Google family through instead of falling back to the legacy list', () => {
    const o = texOptsFromState(stateFor('stripes', { font: 'Satisfy' }))
    expect(o.fontFamily).toBe('Satisfy')
  })

  it('still resolves legacy VARIABLE_FONTS ids to their family', () => {
    const o = texOptsFromState(stateFor('ribbon', { font: 'space-grotesk' }))
    expect(o.fontFamily).toBe('Space Grotesk')
  })

  it('parses local: library tokens to their family', () => {
    const o = texOptsFromState(stateFor('ribbon', { font: 'local:Right Grotesk@700' }))
    expect(o.fontFamily).toBe('Right Grotesk')
  })

  it('pins weight to 400 for static families (no weight axis)', () => {
    setFontCatalog([{ family: 'Satisfy', weights: [400], axes: [] }])
    const o = texOptsFromState(stateFor('stripes', { font: 'Satisfy', typeWeight: 700 }))
    expect(o.fontWeight).toBe(400)
  })

  it("honours an effect's textCase 'asis' default instead of force-uppercasing", () => {
    // stripes declares textCase with default 'asis'; params.textCase left unset.
    const o = texOptsFromState(stateFor('stripes', { text: 'Community' }))
    expect(o.label).toContain('Community')
    expect(o.label).not.toContain('COMMUNITY')
  })

  it('keeps force-upper for effects with no textCase control', () => {
    const o = texOptsFromState(stateFor('ribbon', { text: 'Community' }))
    expect(o.label).toContain('COMMUNITY')
  })

  it('builds one label per line for multi-text (textList) effects', () => {
    const o = texOptsFromState(stateFor('stripes', { text: 'One\nTwo' }))
    expect(o.labels).toHaveLength(2)
  })
})
