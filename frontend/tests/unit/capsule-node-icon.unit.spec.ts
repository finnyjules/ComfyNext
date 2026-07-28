import { describe, it, expect } from 'vitest'
import { resolveNodeIcon } from '~/lib/canvas/nodeIcon'
import { getGeneratorIcon, GENERATOR_NODE_ICONS } from '~/data/generator-icons'

describe('resolveNodeIcon', () => {
  it('returns null for a node type nothing knows about', () => {
    expect(resolveNodeIcon({ nodeType: 'TotallyUnknownNode', category: '' })).toBeNull()
  })

  it('prefers the generator icon over the partner logo', () => {
    // Pick a type that genuinely has a generator icon, so precedence is
    // exercised rather than asserted against a single-source type. If this
    // throws, GENERATOR_NODE_ICONS is empty and the test is meaningless —
    // which is itself worth failing on.
    const [generatorType] = Object.keys(GENERATOR_NODE_ICONS)
    expect(generatorType, 'GENERATOR_NODE_ICONS is empty').toBeTruthy()
    expect(getGeneratorIcon(generatorType)).toBeTruthy()

    // Same node, also claiming a partner category that genuinely resolves
    // (see the note in the next test — 'Gemini' is a real PARTNER_ICONS key):
    // the generator icon should still win.
    const icon = resolveNodeIcon({ nodeType: generatorType, category: 'Gemini' })
    expect(icon?.kind).toBe('component')
  })

  it('tags a partner logo as a url, not a component', () => {
    // 'Gemini' is a real key in PARTNER_ICONS (~/lib/partnerIcons); 'replicate'
    // is not (there is no Replicate entry — partner icons are per-model-brand,
    // e.g. Gemini/Kling/Veo, not per-API-provider), so it would never resolve.
    const icon = resolveNodeIcon({ nodeType: 'NodeWithNoIconOfItsOwn', category: 'Gemini' })
    expect(icon).not.toBeNull()
    expect(icon!.kind).toBe('url')
    expect(typeof icon!.value).toBe('string')
  })

  it('never throws on empty input', () => {
    expect(() => resolveNodeIcon({})).not.toThrow()
    expect(resolveNodeIcon({})).toBeNull()
  })
})
