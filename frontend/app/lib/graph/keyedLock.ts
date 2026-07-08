// FIFO mutual exclusion per string key.
//
// Why this exists: the bridge iframe holds exactly ONE loaded graph per
// worker, and a bridge-mode run is a two-step critical section
// (loadWorkflow → queuePrompt) with an internal delay. Two runs dispatched
// in quick succession on the same worker interleaved those steps — run B's
// load overwrote run A's graph inside the iframe before A's queuePrompt
// fired, so one node's graph was queued twice and the other's never.
// Callers wrap the iframe critical section in withKeyedLock(`bridge-run:N`).
//
// Semantics: sections for the same key run strictly one-at-a-time in call
// order; different keys don't interact; a rejected section rejects for its
// own caller but never poisons the chain for the next acquirer.

const chains = new Map<string, Promise<void>>()

export function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  // Run after the predecessor settles — success or failure alike.
  const run = prev.then(() => fn(), () => fn())
  // The stored tail must never be a rejected promise (that would surface as
  // an unhandled rejection and poison nothing but log noise) — swallow both
  // outcomes; the caller still gets the real `run` with its real rejection.
  const tail = run.then(() => undefined, () => undefined)
  chains.set(key, tail)
  // Drop the map entry once the chain drains so idle keys don't accumulate.
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key) })
  return run
}
