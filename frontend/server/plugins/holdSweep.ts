/**
 * Stale-hold sweep (accounts spec Stage 5, Task 2). Provider preflight
 * RESERVES credits before dispatch and the chokepoint settles or releases
 * that reservation — but a process killed in between leaves the hold open
 * and the credits locked. This plugin runs the backstop sweep on a timer.
 *
 * Hosted-only, and deliberately nothing runs during boot: startHoldSweeper
 * only schedules callbacks (see holdSweep.ts), so a slow or unreachable
 * ledger can never delay or fail Nitro startup.
 *
 * A module singleton on globalThis guards against Nitro HMR spawning
 * duplicate timers in dev — the trainingQueueRunner.ts pattern.
 */
import { startHoldSweeper } from '../utils/holdSweep'

const g = globalThis as unknown as { __sailorHoldSweepStarted?: boolean }

export default defineNitroPlugin(() => {
  if (g.__sailorHoldSweepStarted) return
  if (!startHoldSweeper()) return // local mode — nothing scheduled
  g.__sailorHoldSweepStarted = true
})
