import { describe, it, expect } from 'vitest'
import { resolutionPlanFor } from '../../app/lib/engine/webglPreviewRenderer'

// The pure decision table: clip + resolved preview → which source kind loads.
describe('resolutionPlanFor', () => {
  const base = { id: 'c', start_frame: 0, in_frame: 0, length: 10 }
  it('image clip + image preview → image source', () => {
    expect(resolutionPlanFor({ ...base, kind: 'image' } as any, { url: 'u', kind: 'image' })).toEqual({ kind: 'image', url: 'u' })
  })
  it('video clip + video preview → webcodecs ladder', () => {
    expect(resolutionPlanFor({ ...base, kind: 'video' } as any, { url: 'u', kind: 'video' })).toEqual({ kind: 'video', url: 'u' })
  })
  it('workflow clip resolved to a sequence → sequence source', () => {
    expect(resolutionPlanFor({ ...base, kind: 'workflow', port_index: 1 } as any, { url: 'u0', kind: 'sequence', urls: ['u0', 'u1'] }))
      .toEqual({ kind: 'sequence', urls: ['u0', 'u1'] })
  })
  it('title clip needs no preview → text source', () => {
    expect(resolutionPlanFor({ ...base, kind: 'title', title: {} } as any, null)).toEqual({ kind: 'text' })
  })
  it('unsupported / unresolved → null', () => {
    expect(resolutionPlanFor({ ...base, kind: 'text' } as any, null)).toBeNull()
    expect(resolutionPlanFor({ ...base, kind: 'video' } as any, null)).toBeNull()
  })
})
