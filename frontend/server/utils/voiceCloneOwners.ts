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
 * user. Durable, per-user-scoped ownership of the resulting VOICE lands in
 * Stage 6 Task 5: status.get.ts, on the succeeded branch, reads this
 * binding's userId and writes a `resource_owners` row (kind 'voice') keyed
 * by the voice_id — so the voice gallery scopes per-user across restarts.
 * When this binding is already lost, the voice is left ownerless (curated)
 * rather than mis-attributed; this Map's own volatility is exactly why the
 * durable row is keyed by the binding at write time, not reconstructed later.
 *
 * Deliberately NOT addressed here: result-DISCLOSURE authorization. Any
 * caller who knows a prediction id can still read its status/output via
 * status.get.ts — this module only gates the ledger DEBIT, not visibility
 * of the result. Tenant isolation for status reads is a Stage-5 rider.
 */

/**
 * Stage 5 Task 2 review fix: the binding now also carries the ledger HOLD
 * start.post.ts took. Voice cloning is the one paid route whose charge lands
 * on a LATER request, and start.post.ts used to release its reservation the
 * moment the prediction was created — so N sequential starts all passed the
 * gate against the same untouched balance and all of them charged when they
 * finished. The hold now stays open across the clone and the status poll
 * settles THAT hold (see status.get.ts). `hold` is absent for local-mode
 * bindings (no ledger at all) and for anything recorded before this change.
 *
 * The open hold is bounded by holdSweep's HOLD_TTL_MS (2h). MiniMax voice
 * cloning finishes in minutes, so a legitimate clone always settles long
 * before the sweep; a hold that reaches the TTL means the clone (or this
 * process) died, which is exactly what the sweep exists to clean up.
 */
export interface VoiceCloneHold { holdId: number; credits: number }
interface VoiceCloneBinding { userId: string; hold?: VoiceCloneHold }

const owners = new Map<string, VoiceCloneBinding>()

export function recordVoiceCloneOwner(predictionId: string, userId: string, hold?: VoiceCloneHold): void {
  owners.set(predictionId, { userId, hold })
}

export function voiceCloneOwner(predictionId: string): string | undefined {
  return owners.get(predictionId)?.userId
}

/** The reservation start.post.ts left open for this prediction, if any. */
export function voiceCloneHold(predictionId: string): VoiceCloneHold | undefined {
  return owners.get(predictionId)?.hold
}

export type VoiceCloneSettleDecision =
  | { settle: true; hold?: VoiceCloneHold }
  | { settle: false; reason: 'unknown-owner' | 'not-owner' }

/**
 * The actual gate status.get.ts calls before debiting. Pulled out as its
 * own exported function (rather than inlined in the route) so it's
 * testable directly against the exported ownership helpers, with no route
 * harness needed.
 */
export function decideVoiceCloneSettle(predictionId: string, currentUserId: string | undefined): VoiceCloneSettleDecision {
  const binding = owners.get(predictionId)
  if (!binding) return { settle: false, reason: 'unknown-owner' }
  if (!currentUserId || currentUserId !== binding.userId) return { settle: false, reason: 'not-owner' }
  return { settle: true, hold: binding.hold }
}

/** Test-only seam: clears all recorded ownership between tests. */
export function __resetVoiceCloneOwnersForTests(): void {
  owners.clear()
}
