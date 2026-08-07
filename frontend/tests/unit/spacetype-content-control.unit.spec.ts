import { describe, it, expect } from 'vitest'
import { defaultsFromControls, type ControlSpec } from '~/lib/spacetype/effect'

describe('contentList control kind', () => {
  it('carries a JSON-string default through defaultsFromControls', () => {
    const controls: ControlSpec[] = [
      { key: 'content', label: 'Content', kind: 'contentList', default: '[]', group: 'Type' },
    ]
    const params = defaultsFromControls(controls)
    expect(params.content).toBe('[]')
  })
})
