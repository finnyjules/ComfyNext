// pickWorker — pure least-loaded scheduler for parallel dispatch.
//
// The pool exposes `poolSize` cloud-only worker instances. App-side we number
// workers 1..poolSize (worker 0 is main, the user's own canvas session, and is
// never a scheduling target here). `queueParallel` feeds this the current
// in-flight count per app-side worker (from the run registry + its own
// in-batch assignments) and gets back the worker to place the next item on.
//
// Contract:
//   - inFlightByWorker[i] = number of in-flight runs on app-side worker `i`
//     (index 0 = main, ignored). A missing/undefined entry counts as 0.
//   - Returns the pool worker (1..poolSize) with the fewest in-flight runs;
//     ties resolve to the lowest index.
//   - poolSize 0 → 0 (no pool; caller falls back to main).

export function pickWorker(inFlightByWorker: number[], poolSize: number): number {
  if (poolSize <= 0) return 0

  let best = 1
  let bestLoad = inFlightByWorker[1] ?? 0
  for (let worker = 2; worker <= poolSize; worker++) {
    const load = inFlightByWorker[worker] ?? 0
    if (load < bestLoad) {
      best = worker
      bestLoad = load
    }
  }
  return best
}

// routeSingleRun — spill-to-pool decision for SINGLE direct runs.
//
// Main is preferred while idle: no worker-boot latency, and a lone run gains
// nothing from the pool. Only when main already has a run in flight — and the
// prompt is pool-eligible — does the run spill to the least-loaded pool
// worker, so two quick back-to-back runs execute concurrently instead of
// queueing behind each other on one ComfyUI instance.
export function routeSingleRun(args: {
  eligible: boolean
  mainInFlight: number
  poolInFlight: number[] // index 0 = pool worker 1's load, etc.
  poolSize: number
}): number {
  if (!args.eligible || args.poolSize <= 0 || args.mainInFlight === 0) return 0
  // pickWorker reads app-side indices (1-based); rebuild that shape.
  const byWorker: number[] = [args.mainInFlight]
  for (let i = 0; i < args.poolSize; i++) byWorker[i + 1] = args.poolInFlight[i] ?? 0
  return pickWorker(byWorker, args.poolSize)
}
