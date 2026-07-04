import { describe, expect, it } from 'vitest'
import { extractModelText } from '../../server/lib/modelText'

describe('extractModelText', () => {
  it('returns the first text block', () => {
    const json = { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '{"a":1}' }] }
    expect(extractModelText(json)).toBe('{"a":1}')
  })
  it('throws 502 on empty content', () => {
    for (const json of [{}, { content: [] }, { content: [{ type: 'tool_use' }] }, null, 'nope']) {
      try {
        extractModelText(json)
        expect.unreachable('should have thrown')
      } catch (e: any) {
        expect(e.statusCode).toBe(502)
      }
    }
  })
  it('throws 502 on empty-string text', () => {
    try {
      extractModelText({ content: [{ type: 'text', text: '' }] })
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e.statusCode).toBe(502)
    }
  })
})
