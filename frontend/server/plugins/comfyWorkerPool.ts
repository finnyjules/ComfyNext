/**
 * Reaper for the ComfyUI worker pool. Runs inside the Nitro server: every 60s
 * it SIGTERMs any self-spawned worker (has a pid — adopted workers never
 * carry one) that's been idle (ready, no touchWorker()) for more than 15
 * minutes. Mirrors server/plugins/trainingQueue.ts's globalThis-guarded
 * singleton timer so Nitro HMR in dev never stacks duplicate intervals.
 */
import { listWorkers, shouldReap, removeWorker, getWorkerProcess } from '../utils/comfyWorkerPool'

const REAP_INTERVAL_MS = 60_000

// Survives HMR: store the timer on globalThis so a re-import clears the old one.
const g = globalThis as unknown as { __cnComfyPoolReapTimer?: ReturnType<typeof setInterval> }

export default defineNitroPlugin(() => {
  if (g.__cnComfyPoolReapTimer) clearInterval(g.__cnComfyPoolReapTimer)

  const reap = () => {
    const now = Date.now()
    for (const worker of listWorkers()) {
      if (!shouldReap(worker, now)) continue
      const child = getWorkerProcess(worker.index)
      try {
        child?.kill('SIGTERM')
      } catch (err) {
        console.error(`[comfy-pool] failed to kill worker ${worker.index} (pid ${worker.pid}):`, err)
      }
      removeWorker(worker.index)
      console.log(`[comfy-pool] reaped idle worker ${worker.index} (port ${worker.port}, pid ${worker.pid})`)
    }
  }

  g.__cnComfyPoolReapTimer = setInterval(reap, REAP_INTERVAL_MS)
  console.log(`[comfy-pool] reaper started (interval=${REAP_INTERVAL_MS}ms)`)
})
