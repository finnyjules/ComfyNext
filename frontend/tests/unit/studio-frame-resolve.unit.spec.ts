// frontend/tests/unit/studio-frame-resolve.unit.spec.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  registerStudioFrameSource,
  unregisterStudioFrameSource,
  type StudioFrameSource,
} from '~/lib/studio/frameSource'
import { resolveWiredSourceKind } from '~/lib/studio/frameResolve'

const frames = (over: Partial<StudioFrameSource> = {}): StudioFrameSource => ({
  getFrame: async () => ({} as any), duration: 5, fps: 24, width: 800, height: 600, ...over,
})
const edge = (source: string, target: string, handle: string, sourceHandle?: string) =>
  ({ source, target, targetHandle: handle, sourceHandle })

describe('resolveWiredSourceKind', () => {
  beforeEach(() => { unregisterStudioFrameSource('up') })

  it('returns null when nothing is wired to the handle', () => {
    expect(resolveWiredSourceKind('f1', 'input-3', [{ id: 'f1', data: {} }], [])).toBeNull()
  })

  it('prefers a live upstream frame source over the artifact file', () => {
    const src = frames()
    registerStudioFrameSource('up', src)
    const nodes = [{ id: 'f1', data: {} }, { id: 'up', data: { images: ['/view?stale.png'] } }]
    const got = resolveWiredSourceKind('f1', 'input-3', nodes, [edge('up', 'f1', 'input-3')])
    expect(got).toEqual({ kind: 'live', source: src })
  })

  it('falls back to images[0] when no live source', () => {
    const nodes = [{ id: 'f1', data: {} }, { id: 'up', data: { images: ['/view?a.png'] } }]
    const got = resolveWiredSourceKind('f1', 'input-0', nodes, [edge('up', 'f1', 'input-0')])
    expect(got).toEqual({ kind: 'url', url: '/view?a.png' })
  })

  it('honors the multi-output source handle index', () => {
    const nodes = [{ id: 'f1', data: {} }, { id: 'up', data: { images: ['/view?bg.png', '/view?fg.png'] } }]
    const got = resolveWiredSourceKind('f1', 'input-2', nodes, [edge('up', 'f1', 'input-2', 'output-1')])
    expect(got).toEqual({ kind: 'url', url: '/view?fg.png' })
  })

  it('builds a /view URL for a LoadImage source', () => {
    const nodes = [{ id: 'f1', data: {} }, { id: 'up', data: { nodeType: 'LoadImage', widgetsValues: ['p.jpg'] } }]
    const got = resolveWiredSourceKind('f1', 'input-1', nodes, [edge('up', 'f1', 'input-1')])
    expect(got?.kind).toBe('url')
    expect((got as any).url).toContain('filename=p.jpg')
  })

  it('builds a /view URL for an Image artifact widget (name lookup)', () => {
    const nodes = [
      { id: 'f1', data: {} },
      { id: 'up', data: { nodeType: 'Image', widgetDefs: [{ name: 'x' }, { name: 'image' }], widgetsValues: ['n', 'pasted.png'] } },
    ]
    const got = resolveWiredSourceKind('f1', 'input-1', nodes, [edge('up', 'f1', 'input-1')])
    expect((got as any).url).toContain('filename=pasted.png')
  })

  it('matches only the requested handle, not other slots', () => {
    const nodes = [{ id: 'f1', data: {} }, { id: 'up', data: { images: ['/view?a.png'] } }]
    const edges = [edge('up', 'f1', 'input-5')]
    expect(resolveWiredSourceKind('f1', 'input-2', nodes, edges)).toBeNull()
    expect(resolveWiredSourceKind('f1', 'input-5', nodes, edges)).toEqual({ kind: 'url', url: '/view?a.png' })
  })

  it('coerces numeric ids (litegraph) when matching', () => {
    const src = frames()
    registerStudioFrameSource('up', src)
    const nodes = [{ id: 1, data: {} }, { id: 'up', data: {} }]
    const got = resolveWiredSourceKind('1', 'input-0', nodes, [{ source: 'up', target: 1, targetHandle: 'input-0' }])
    expect(got).toEqual({ kind: 'live', source: src })
  })
})
