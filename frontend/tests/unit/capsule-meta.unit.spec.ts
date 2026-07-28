import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { collapseTier, readoutRuleFor, defaultCollapsed, COLLAPSE_TIERS, READOUT_RULES } from '~/lib/canvas/capsuleMeta'

// The node types actually registered with vue-flow, READ FROM THE SOURCE.
// This used to be a hand-copied array of 28 strings that claimed to catch
// drift and could not: a 29th type added to nodeTypes appears in neither list,
// so both guards below stayed green while the tier table silently fell behind.
// Parsing the real object literal is the only version of this test that can
// fail for the reason it says it fails.
const CANVAS_SRC = fileURLToPath(new URL('../../app/components/vue-canvas/VueNodeCanvas.vue', import.meta.url))

function registeredNodeTypes(): string[] {
  const src = readFileSync(CANVAS_SRC, 'utf8')
  const start = src.indexOf('const nodeTypes = {')
  const end = src.indexOf('} as NodeTypesObject', start)
  if (start < 0 || end < 0) throw new Error('nodeTypes literal not found in VueNodeCanvas.vue — update this parser')
  const body = src.slice(start, end)
  // Every entry is `key: markRaw(Component)`, quoted or bare.
  const keys = [...body.matchAll(/(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_$-]+))\s*:\s*markRaw\(/g)]
    .map(m => m[1] ?? m[2] ?? m[3]!)
  if (keys.length < 20) throw new Error(`only parsed ${keys.length} node types — the parser has gone stale`)
  return keys
}

const REGISTERED_TYPES = registeredNodeTypes()

describe('collapseTier', () => {
  it('parses the registration list rather than trusting a copy of it', () => {
    // Guards the guard: if the regex silently stops matching, every drift
    // check below degrades to a no-op over an empty array.
    expect(REGISTERED_TYPES).toContain('comfy')
    expect(REGISTERED_TYPES).toContain('sketch-pile')
    expect(new Set(REGISTERED_TYPES).size).toBe(REGISTERED_TYPES.length)
  })

  it('assigns every registered node type a tier', () => {
    const missing = REGISTERED_TYPES.filter(t => !(t in COLLAPSE_TIERS))
    expect(missing).toEqual([])
  })

  it('does not carry tiers for types that no longer exist', () => {
    const stale = Object.keys(COLLAPSE_TIERS).filter(t => !REGISTERED_TYPES.includes(t))
    expect(stale).toEqual([])
  })

  it('groups the summary-card editors together', () => {
    // Both are a compact card plus an "open the editor" button, rendering
    // nothing live themselves — so they belong in the same tier.
    expect(collapseTier('lip-sync')).toBe('after-run')
    expect(collapseTier('shot-director')).toBe('after-run')
  })

  it('collapses machinery with no output of its own', () => {
    expect(collapseTier('comfy')).toBe('after-run')
    expect(collapseTier('gate')).toBe('always')
    expect(collapseTier('subgraph-io')).toBe('always')
  })

  it('never collapses the content itself', () => {
    for (const t of ['artifact-image', 'artifact-frame', 'artifact-video', 'note', 'sketch-pile']) {
      expect(collapseTier(t)).toBe('never')
    }
  })

  it('leaves anything with a live preview to the user', () => {
    // shader-effect renders a live WebGL canvas on the card; reference and
    // character render the picked asset's thumbnail. Collapsing those by
    // default hides the whole reason the node is on the canvas.
    for (const t of ['gradient-studio', 'shader-studio', 'space-type', 'scene3d-studio',
                     'shader-effect', 'reference', 'character']) {
      expect(collapseTier(t)).toBe('manual')
    }
  })

  it('treats an unknown type as never, so a new node is never hidden by accident', () => {
    expect(collapseTier('some-future-node')).toBe('never')
  })
})

describe('defaultCollapsed', () => {
  it('collapses always-tier types immediately', () => {
    expect(defaultCollapsed('gate', false)).toBe(true)
  })

  it('holds after-run types open until they have run', () => {
    expect(defaultCollapsed('comfy', false)).toBe(false)
    expect(defaultCollapsed('comfy', true)).toBe(true)
  })

  it('never collapses content or studios by default', () => {
    expect(defaultCollapsed('artifact-image', true)).toBe(false)
    expect(defaultCollapsed('gradient-studio', true)).toBe(false)
  })
})

describe('readoutRuleFor', () => {
  it('declares a widgets rule for KSampler', () => {
    expect(readoutRuleFor('KSampler')).toEqual({
      from: 'widgets',
      parts: [{ name: 'steps', suffix: ' steps' }, { name: 'cfg', prefix: 'guidance ' }],
    })
  })

  it('declares a text rule for the prompt encoder', () => {
    expect(readoutRuleFor('CLIPTextEncode')).toEqual({ from: 'text', property: 'text', max: 28 })
  })

  it('returns undefined for an undeclared type — silence, not a guess', () => {
    expect(readoutRuleFor('SomeNodeNobodyMapped')).toBeUndefined()
  })

  it('caps every declared widgets rule at two parts', () => {
    // The resolver caps at render time too, but a three-part declaration is a
    // mistake in the data and should be caught here where it is authored.
    for (const [type, rule] of Object.entries(READOUT_RULES)) {
      if (rule.from === 'widgets') {
        expect(rule.parts.length, `${type} declares too many parts`).toBeLessThanOrEqual(2)
      }
    }
  })
})
