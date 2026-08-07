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

  it('never reorders: saved ports keep their indices, missing schema ports append', () => {
    // Divergent-era save: the schema no longer contains 'a' at all. Saved
    // entries stay put (edges reference ports by index), and every schema
    // port whose NAME the save lacks appends at the tail — a positional
    // slice would silently drop 'x' here.
    const a = { name: 'a', type: 'IMAGE', links: [1] }
    const merged = syncNodeOutputsWithSchema([a], [
      { name: 'x', type: 'LATENT', links: null },
      { name: 'y', type: 'MASK', links: null },
    ])
    expect(merged).toEqual([a, { name: 'x', type: 'LATENT', links: null }, { name: 'y', type: 'MASK', links: null }])
  })

  it('appends by name when the saved snapshot is LONGER than the schema (era drift)', () => {
    // Found live (moodboards, 2026-08-07): a GenerateImageNode saved in the
    // image_1..6 ref-port era never gained style_in/prompt_in because the
    // length check saw 6 >= 2 and bailed. Names, not lengths, decide.
    const saved = Array.from({ length: 6 }, (_, i) => ({ name: `image_${i + 1}`, type: 'IMAGE', links: null }))
    const merged = syncNodeOutputsWithSchema(saved, [
      { name: 'style_in', type: 'TASTE', links: null },
      { name: 'prompt_in', type: 'STRING', links: null },
    ])
    expect(merged!.map(p => p.name)).toEqual([
      'image_1', 'image_2', 'image_3', 'image_4', 'image_5', 'image_6', 'style_in', 'prompt_in',
    ])
    // saved entries by reference — link state untouched
    expect(merged![0]).toBe(saved[0])
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
