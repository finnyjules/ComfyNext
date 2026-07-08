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
