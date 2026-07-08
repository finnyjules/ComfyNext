/**
 * POST /api/pool/ensure
 * Body: { worker: number }
 * Ensures the given worker index (a headless ComfyUI instance, see
 * server/utils/comfyWorkerPool.ts) is spawned/adopted and ready, then returns
 * its port and status. Used by parallel dispatch to route cloud-only prompts
 * to a worker instead of queuing behind the user's own canvas session.
 *
 * Must be allowlisted in server/middleware/comfyui-proxy.ts (NITRO_API_PREFIXES)
 * since `/api` is otherwise proxied straight to ComfyUI on :8188.
 */
import { ensureWorker, poolSize, touchWorker } from '../../utils/comfyWorkerPool'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as { worker?: number }
  const worker = Number(body?.worker)

  if (!Number.isInteger(worker) || worker < 0 || worker >= poolSize()) {
    throw createError({ statusCode: 400, message: `worker index out of range (pool size ${poolSize()})` })
  }

  const state = await ensureWorker(worker)
  touchWorker(worker)
  return { port: state.port, status: state.status }
})
