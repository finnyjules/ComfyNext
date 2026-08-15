/**
 * Voice-clone prediction ownership (final-review fix, Stage 4 metering):
 * binds a Replicate prediction id to the userId that started it, so
 * status.get.ts's debit-on-success settle only ever charges the person who
 * paid the preflight in start.post.ts — not whoever happens to poll the
 * status route with that prediction id next.
 *
 * v1 semantics: this is a process-local, in-memory Map. It is NOT durable —
 * a server restart between start and a later status poll loses the
 * ownership record entirely. When that happens, settle is SKIPPED (see
 * status.get.ts) rather than guessed at: an unowned prediction is treated
 * as "cannot verify who to charge", and the safe failure direction here is
 * under-charging (the job is still delivered), never charging the wrong
 * user. Durable, per-user-scoped ownership storage lands with Stage 5's
 * per-user data model.
 *
 * Deliberately NOT addressed here: result-DISCLOSURE authorization. Any
 * caller who knows a prediction id can still read its status/output via
 * status.get.ts — this module only gates the ledger DEBIT, not visibility
 * of the result. Tenant isolation for status reads is a Stage-5 rider.
 */

const owners = new Map<string, string>()

export function recordVoiceCloneOwner(predictionId: string, userId: string): void {
  owners.set(predictionId, userId)
}

export function voiceCloneOwner(predictionId: string): string | undefined {
  return owners.get(predictionId)
}

export type VoiceCloneSettleDecision =
  | { settle: true }
  | { settle: false; reason: 'unknown-owner' | 'not-owner' }

/**
 * The actual gate status.get.ts calls before debiting. Pulled out as its
 * own exported function (rather than inlined in the route) so it's
 * testable directly against the exported ownership helpers, with no route
 * harness needed.
 */
export function decideVoiceCloneSettle(predictionId: string, currentUserId: string | undefined): VoiceCloneSettleDecision {
  const owner = voiceCloneOwner(predictionId)
  if (!owner) return { settle: false, reason: 'unknown-owner' }
  if (!currentUserId || currentUserId !== owner) return { settle: false, reason: 'not-owner' }
  return { settle: true }
}

/** Test-only seam: clears all recorded ownership between tests. */
export function __resetVoiceCloneOwnersForTests(): void {
  owners.clear()
}
