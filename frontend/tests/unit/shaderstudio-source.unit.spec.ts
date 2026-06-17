// frontend/tests/unit/shaderstudio-source.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { resolveWiredInput } from '~/lib/shaderstudio/source'

describe('resolveWiredInput', () => {
  const studio = { id: 's1', data: {} }

  it('returns null when nothing is wired to input-0', () => {
    expect(resolveWiredInput('s1', [studio], [])).toBeNull()
  })

  it('returns the upstream node images[0] when present', () => {
    const up = { id: 'a', data: { images: ['/view?filename=x.png&type=output'] } }
    const edges = [{ source: 'a', target: 's1', targetHandle: 'input-0' }]
    expect(resolveWiredInput('s1', [studio, up], edges)).toBe('/view?filename=x.png&type=output')
  })

  it('builds a /view URL for an upstream LoadImage widget', () => {
    const up = { id: 'a', data: { nodeType: 'LoadImage', widgetsValues: ['photo.jpg'] } }
    const edges = [{ source: 'a', target: 's1', targetHandle: 'input-0' }]
    const url = resolveWiredInput('s1', [studio, up], edges)
    expect(url).toContain('filename=photo.jpg')
    expect(url).toContain('type=input')
  })
})
