import { describe, it, expect } from 'vitest'
import { typesCompatible, typeUnion, findCompatiblePortIndex, bestPortPair } from '../../app/utils/portTypes'

// The Timeline → SaveVideo regression: every auto-pick of a port for a typed
// link must follow these rules (exact → union/wildcard, NEVER index 0).

describe('typeUnion', () => {
  it('splits comma unions and trims', () => {
    expect(typeUnion('IMAGE,VIDEO')).toEqual(['IMAGE', 'VIDEO'])
    expect(typeUnion(' IMAGE , VIDEO ')).toEqual(['IMAGE', 'VIDEO'])
    expect(typeUnion('IMAGE')).toEqual(['IMAGE'])
    expect(typeUnion('')).toEqual([])
    expect(typeUnion(null)).toEqual([])
  })
})

describe('typesCompatible', () => {
  it('exact and wildcard', () => {
    expect(typesCompatible('IMAGE', 'IMAGE')).toBe(true)
    expect(typesCompatible('*', 'VIDEO')).toBe(true)
    expect(typesCompatible('VIDEO', '*')).toBe(true)
    expect(typesCompatible('IMAGE', 'VIDEO')).toBe(false)
    expect(typesCompatible('', 'IMAGE')).toBe(false)
  })
  it('comma unions intersect (Timeline clip inputs accept IMAGE,VIDEO)', () => {
    expect(typesCompatible('VIDEO', 'IMAGE,VIDEO')).toBe(true)
    expect(typesCompatible('IMAGE', 'IMAGE,VIDEO')).toBe(true)
    expect(typesCompatible('IMAGE,VIDEO', 'VIDEO')).toBe(true)
    expect(typesCompatible('AUDIO', 'IMAGE,VIDEO')).toBe(false)
    expect(typesCompatible('IMAGE,VIDEO', 'AUDIO,LATENT')).toBe(false)
  })
})

describe('findCompatiblePortIndex', () => {
  // Timeline outputs as shipped: slot 0 = frames (IMAGE), slot 1 = video (VIDEO)
  const timelineOutputs = [{ type: 'IMAGE' }, { type: 'VIDEO' }]

  it('picks the VIDEO output for a VIDEO input — the user-facing bug', () => {
    expect(findCompatiblePortIndex(timelineOutputs, 'VIDEO')).toBe(1)
  })
  it('exact match beats union/wildcard match', () => {
    const ports = [{ type: 'IMAGE,VIDEO' }, { type: 'VIDEO' }]
    expect(findCompatiblePortIndex(ports, 'VIDEO')).toBe(1)
  })
  it('falls back to union compatibility when no exact match', () => {
    const ports = [{ type: 'AUDIO' }, { type: 'IMAGE,VIDEO' }]
    expect(findCompatiblePortIndex(ports, 'VIDEO')).toBe(1)
  })
  it('returns -1 (never 0) when nothing matches', () => {
    expect(findCompatiblePortIndex([{ type: 'VIDEO' }], 'IMAGE')).toBe(-1)
    expect(findCompatiblePortIndex([], 'IMAGE')).toBe(-1)
    expect(findCompatiblePortIndex(null, 'IMAGE')).toBe(-1)
  })
  it('prefers free ports within each tier (grow-on-connect clip slots)', () => {
    const clipInputs = [{ type: 'IMAGE,VIDEO' }, { type: 'IMAGE,VIDEO' }]
    const occupied = new Set([0])
    expect(findCompatiblePortIndex(clipInputs, 'VIDEO', (i) => !occupied.has(i))).toBe(1)
    // All occupied → still picks a compatible port rather than nothing.
    expect(findCompatiblePortIndex(clipInputs, 'VIDEO', () => false)).toBe(0)
  })
})

describe('bestPortPair', () => {
  const timelineOutputs = [{ type: 'IMAGE' }, { type: 'VIDEO' }]

  it('SaveVideo dropped near a Timeline taps the VIDEO output, not frames', () => {
    const saveVideoInputs = [{ type: 'VIDEO' }]
    expect(bestPortPair(timelineOutputs, saveVideoInputs)).toEqual({ outputIndex: 1, inputIndex: 0 })
  })
  it('exact pairs beat union pairs', () => {
    const inputs = [{ type: 'IMAGE,VIDEO' }, { type: 'IMAGE' }]
    expect(bestPortPair(timelineOutputs, inputs)).toEqual({ outputIndex: 0, inputIndex: 1 })
  })
  it('null when nothing connects', () => {
    expect(bestPortPair(timelineOutputs, [{ type: 'AUDIO' }])).toBeNull()
    expect(bestPortPair([], [{ type: 'VIDEO' }])).toBeNull()
  })
})
