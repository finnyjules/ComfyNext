import { describe, expect, it } from 'vitest'
import { linkDecision, type LinkDecisionInput } from '~~/server/utils/characterLink'

/**
 * Pure decision logic for character-link collisions.
 * Tests the four cases: claim-draft, update-same, create new, and collision.
 */

describe('linkDecision', () => {
  it('claim-draft: matched record with loraName === null flips to ready', () => {
    const existing: LinkDecisionInput = { loraName: null }
    expect(linkDecision(existing, 'weights-v1.safetensors')).toBe('claim-draft')
  })

  it('update-same: matched record already ready with the same loraName is idempotent', () => {
    const existing: LinkDecisionInput = { loraName: 'weights-v1.safetensors' }
    expect(linkDecision(existing, 'weights-v1.safetensors')).toBe('update-same')
  })

  it('collide-new: matched record already ready with a DIFFERENT loraName creates a new record', () => {
    const existing: LinkDecisionInput = { loraName: 'weights-v1.safetensors' }
    expect(linkDecision(existing, 'weights-v2.safetensors')).toBe('collide-new')
  })

  it('create: no existing record creates a fresh one', () => {
    expect(linkDecision(null, 'weights-v1.safetensors')).toBe('create')
  })
})
