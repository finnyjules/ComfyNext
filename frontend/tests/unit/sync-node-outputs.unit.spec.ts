import { describe, it, expect } from 'vitest'
import { schemaOutputsFromInfo, syncNodeOutputsWithSchema, type NodeOutputPort } from '~/utils/syncNodeOutputs'

const frames: NodeOutputPort = { name: 'frames', type: 'IMAGE', links: [3] }
const video: NodeOutputPort = { name: 'video', type: 'VIDEO', links: null }

describe('syncNodeOutputsWithSchema', () => {
  it('appends missing trailing outputs (Timeline frames-only save gains video)', () => {
    const merged = syncNodeOutputsWithSchema([frames], [
      { name: 'frames', type: 'IMAGE', links: null },
      video,
    ])
    expect(merged).toEqual([frames, video])
    // Saved entry kept verbatim (link data preserved), by reference
    expect(merged![0]).toBe(frames)
  })

  it('never reorders: saved order is kept even if schema names differ', () => {
    const a = { name: 'a', type: 'IMAGE', links: [1] }
    const merged = syncNodeOutputsWithSchema([a], [
      { name: 'x', type: 'LATENT', links: null },
      { name: 'y', type: 'MASK', links: null },
    ])
    expect(merged).toEqual([a, { name: 'y', type: 'MASK', links: null }])
  })

  it('no-op (null) when saved already matches schema length', () => {
    expect(syncNodeOutputsWithSchema([frames, video], [
      { name: 'frames', type: 'IMAGE', links: null },
      { name: 'video', type: 'VIDEO', links: null },
    ])).toBeNull()
  })

  it('no-op when schema is unknown (objectInfo missing the type)', () => {
    expect(syncNodeOutputsWithSchema([frames], [])).toBeNull()
    expect(syncNodeOutputsWithSchema([frames], null)).toBeNull()
    expect(syncNodeOutputsWithSchema([frames], undefined)).toBeNull()
  })

  it('no-op when saved has MORE outputs than schema (never remove)', () => {
    expect(syncNodeOutputsWithSchema([frames, video], [
      { name: 'frames', type: 'IMAGE', links: null },
    ])).toBeNull()
  })

  it('handles missing saved outputs (treated as empty, full schema appended)', () => {
    expect(syncNodeOutputsWithSchema(undefined, [video])).toEqual([video])
  })
})

describe('schemaOutputsFromInfo', () => {
  it('maps output/output_name pairs from an /object_info entry', () => {
    expect(schemaOutputsFromInfo({ output: ['IMAGE', 'VIDEO'], output_name: ['frames', 'video'] }))
      .toEqual([
        { name: 'frames', type: 'IMAGE', links: null },
        { name: 'video', type: 'VIDEO', links: null },
      ])
  })

  it('falls back to the type as name and to [] for missing info', () => {
    expect(schemaOutputsFromInfo({ output: ['IMAGE'] })).toEqual([{ name: 'IMAGE', type: 'IMAGE', links: null }])
    expect(schemaOutputsFromInfo(undefined)).toEqual([])
  })
})
