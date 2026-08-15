/**
 * Final-review fix (Stage 4 metering): voice-clone settle ownership binding.
 * Without this, status.get.ts settled the CURRENT context user for ANY
 * prediction id passed in — user B polling user A's prediction id charged
 * user A's ledger, and because ledger idempotency is per-user, both users
 * could end up charged for the same job.
 *
 * These tests exercise the exported ownership helpers directly (no route
 * harness) — see server/utils/voiceCloneOwners.ts's module doc for the v1
 * process-local semantics (a restart loses ownership; settle is SKIPPED in
 * that case, never guessed at).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetVoiceCloneOwnersForTests,
  decideVoiceCloneSettle,
  recordVoiceCloneOwner,
  voiceCloneOwner,
} from '../../server/utils/voiceCloneOwners'

beforeEach(() => {
  __resetVoiceCloneOwnersForTests()
})

describe('recordVoiceCloneOwner / voiceCloneOwner', () => {
  it('round-trips a recorded owner', () => {
    recordVoiceCloneOwner('pred_1', 'user_a')
    expect(voiceCloneOwner('pred_1')).toBe('user_a')
  })

  it('is undefined for a prediction id that was never recorded', () => {
    expect(voiceCloneOwner('pred_never_seen')).toBeUndefined()
  })
})

describe('decideVoiceCloneSettle', () => {
  it('the owner polling their own prediction: settles', () => {
    recordVoiceCloneOwner('pred_1', 'user_a')
    expect(decideVoiceCloneSettle('pred_1', 'user_a')).toEqual({ settle: true })
  })

  it('a non-owner polling someone else\'s prediction: no settle, reason not-owner', () => {
    recordVoiceCloneOwner('pred_1', 'user_a')
    expect(decideVoiceCloneSettle('pred_1', 'user_b')).toEqual({ settle: false, reason: 'not-owner' })
  })

  it('unknown owner (e.g. a restart lost the record): no settle, reason unknown-owner', () => {
    expect(decideVoiceCloneSettle('pred_never_recorded', 'user_a')).toEqual({ settle: false, reason: 'unknown-owner' })
  })

  it('no current user at all (unauthenticated context) against a known owner: no settle, reason not-owner', () => {
    recordVoiceCloneOwner('pred_1', 'user_a')
    expect(decideVoiceCloneSettle('pred_1', undefined)).toEqual({ settle: false, reason: 'not-owner' })
  })
})
