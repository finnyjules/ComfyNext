import { describe, it, expect } from 'vitest'
import {
  nextFreeSocket, tokenizeElementContent, columnLabelForElement, isBoundToken,
} from '~/lib/collection/layoutPromote'

describe('nextFreeSocket', () => {
  it('returns text_layer_1 when nothing is taken', () => {
    expect(nextFreeSocket({}, 'text')).toBe('text_layer_1')
    expect(nextFreeSocket({}, 'image')).toBe('image_layer_1')
  })

  it('skips names already used as {{ props.x }} tokens in the template', () => {
    const t = { sections: [{ children: [
      { id: 'e1', type: 'text', content: 'Hello {{ props.text_layer_1 }}' },
    ] }] }
    expect(nextFreeSocket(t, 'text')).toBe('text_layer_2')
  })

  it('skips names taken by multiple tokens, returning the first gap-free name', () => {
    const t = { sections: [{ children: [
      { content: '{{ props.text_layer_1 }}' },
      { content: '{{ props.text_layer_2 }}' },
    ] }] }
    expect(nextFreeSocket(t, 'text')).toBe('text_layer_3')
  })

  it('skips names taken by element role fields', () => {
    const t = { sections: [{ children: [
      { id: 'e1', type: 'text', role: 'TEXT_LAYER_1', content: 'static' },
    ] }] }
    expect(nextFreeSocket(t, 'text')).toBe('text_layer_2')
  })

  it('role matching is case-insensitive', () => {
    const t = { sections: [{ children: [
      { id: 'e1', type: 'text', role: 'text_layer_1', content: 'static' },
    ] }] }
    expect(nextFreeSocket(t, 'text')).toBe('text_layer_2')
  })

  it('does not cross-contaminate text and image kinds', () => {
    const t = { sections: [{ children: [
      { role: 'TEXT_LAYER_1' },
      { content: '{{ props.image_layer_1 }}' },
    ] }] }
    expect(nextFreeSocket(t, 'text')).toBe('text_layer_2')
    expect(nextFreeSocket(t, 'image')).toBe('image_layer_2')
  })

  it('combines role and token sources to find the first free gap', () => {
    const t = { sections: [{ children: [
      { role: 'TEXT_LAYER_2' },
      { content: '{{ props.text_layer_1 }}' },
    ] }] }
    // text_layer_1 and text_layer_2 both taken -> next is text_layer_3
    expect(nextFreeSocket(t, 'text')).toBe('text_layer_3')
  })

  it('handles a malformed/unstringifiable template gracefully', () => {
    const circular: any = {}
    circular.self = circular
    expect(nextFreeSocket(circular, 'text')).toBe('text_layer_1')
  })
})

describe('tokenizeElementContent', () => {
  it('returns the prior content unchanged, pure (no mutation of caller state)', () => {
    const el = { content: 'Hello world' }
    const result = tokenizeElementContent(el, 'text_layer_3')
    expect(result).toEqual({ priorContent: 'Hello world' })
    expect(el.content).toBe('Hello world') // unmutated
  })

  it('treats missing content as empty string', () => {
    const el = {}
    expect(tokenizeElementContent(el, 'text_layer_1')).toEqual({ priorContent: '' })
  })
})

describe('columnLabelForElement', () => {
  it('prefers the element name first', () => {
    const label = columnLabelForElement({ name: 'Hero Title', role: 'HEADLINE', content: 'Buy now' }, 'Buy now')
    expect(label).toBe('Hero Title')
  })

  it('falls back to role (lowercased) when name is absent', () => {
    const label = columnLabelForElement({ role: 'HEADLINE', content: 'Buy now' }, 'Buy now')
    expect(label).toBe('headline')
  })

  it('falls back to a slug of prior content when name and role are absent', () => {
    const label = columnLabelForElement({}, 'Summer Sale Starts Now')
    expect(label).toBe('summer_sale_starts_now')
  })

  it('slugs content using keyFromLabel-style cleanup', () => {
    const label = columnLabelForElement({}, 'Hello, World! 50% Off')
    expect(label).toBe('hello_world_50_off')
  })

  it('truncates prior content to ~24 chars before slugging', () => {
    const long = 'This is a very long headline that goes on and on and on'
    const label = columnLabelForElement({}, long)
    // pre-slug truncation to ~24 chars means slug should derive only from the prefix
    const expectedPrefix = long.slice(0, 24).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    expect(label).toBe(expectedPrefix)
    expect(label.length).toBeLessThanOrEqual(24)
  })

  it('falls back to the socket name when name, role, and content are all empty', () => {
    const label = columnLabelForElement({}, '', 'text_layer_4')
    expect(label).toBe('text_layer_4')
  })

  it('never returns empty string even with all-whitespace inputs', () => {
    const label = columnLabelForElement({ name: '   ', role: '' }, '   ', 'text_layer_5')
    expect(label).toBe('text_layer_5')
    expect(label.length).toBeGreaterThan(0)
  })

  it('falls back through when content slugs to empty (e.g. punctuation only)', () => {
    const label = columnLabelForElement({}, '!!!', 'text_layer_6')
    expect(label).toBe('text_layer_6')
  })
})

describe('isBoundToken', () => {
  it('returns the socket name for an exact whole-token match', () => {
    expect(isBoundToken('{{ props.text_layer_1 }}')).toBe('text_layer_1')
  })

  it('tolerates surrounding/internal whitespace variance', () => {
    expect(isBoundToken('{{  props.x  }}')).toBe('x')
    expect(isBoundToken('{{props.x}}')).toBe('x')
    expect(isBoundToken('{{   props.text_layer_2   }}')).toBe('text_layer_2')
  })

  it('rejects mixed content around the token', () => {
    expect(isBoundToken('Hi {{ props.x }}')).toBeNull()
    expect(isBoundToken('{{ props.x }} there')).toBeNull()
  })

  it('rejects multiple tokens', () => {
    expect(isBoundToken('{{ props.x }}{{ props.y }}')).toBeNull()
  })

  it('rejects plain text and empty/undefined content', () => {
    expect(isBoundToken('plain text')).toBeNull()
    expect(isBoundToken('')).toBeNull()
    expect(isBoundToken(undefined)).toBeNull()
  })

  it('rejects a token with leading/trailing whitespace around the whole string but still whole-match aware', () => {
    // whole content is just the token plus outer whitespace -> still bound (trim-tolerant)
    expect(isBoundToken('  {{ props.x }}  ')).toBe('x')
  })
})
