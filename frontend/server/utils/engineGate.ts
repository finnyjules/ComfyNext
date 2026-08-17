/**
 * Hosted tenant gates for shared-engine endpoints (Stage 5 Task 5). Pure
 * filters + thin h3 handlers. Local mode never reaches any of this —
 * comfyui-proxy and the history/view routes call these ONLY under
 * deployMode() === 'hosted'.
 */
import type { H3Event } from 'h3'
import { createError, setResponseStatus } from 'h3'
import { ownedPromptIds, ownsPrompt, pendingRuns } from './graphRuns'
import { resolveWorkerTarget } from './workerRoute'
import { settleGraphSuccess } from './meterGraphRun'

export function filterQueuePayload(queue: any, owned: Set<string>): any {
  const keep = (entries: any[]) => (Array.isArray(entries) ? entries : []).filter(e => owned.has(String(e?.[1])))
  return { ...queue, queue_running: keep(queue?.queue_running), queue_pending: keep(queue?.queue_pending) }
}

export function filterHistoryPayload(hist: Record<string, any>, owned: Set<string>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [id, entry] of Object.entries(hist ?? {})) if (owned.has(id)) out[id] = entry
  return out
}

export async function handleHostedQueueGet(event: H3Event): Promise<any> {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
  const { port } = resolveWorkerTarget(event.path)
  const res = await fetch(`http://127.0.0.1:${port}/queue`)
  if (!res.ok) throw createError({ statusCode: 502, message: 'Engine queue unavailable' })
  return filterQueuePayload(await res.json(), await ownedPromptIds(userId))
}

export async function handleHostedInterrupt(event: H3Event): Promise<any> {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
  const { port } = resolveWorkerTarget(event.path)
  const target = `http://127.0.0.1:${port}`
  const qres = await fetch(`${target}/queue`)
  const queue = qres.ok ? await qres.json() : {}
  const running = Array.isArray(queue?.queue_running) ? queue.queue_running : []
  const runningId = running.length ? String(running[0]?.[1]) : null
  if (!runningId || !(await ownsPrompt(userId, runningId))) {
    throw createError({ statusCode: 403, message: 'No interruptible run of yours is active' })
  }
  const res = await fetch(`${target}/interrupt`, { method: 'POST', headers: { origin: target } })
  setResponseStatus(event, res.status)
  return null
}

const MAIN_ENGINE = 'http://127.0.0.1:8188'
const HARVEST_CAP = 20

/**
 * /view race-window fallback: the client saw the WS 'executed' event a beat
 * before the settle watcher (settleOnCompletion, polling every 2s) recorded
 * this run's outputs into graph_runs. Rather than reimplement settlement,
 * this re-polls the same main-engine history endpoint the watcher uses and
 * calls the SAME settleGraphSuccess exported from meterGraphRun.ts — one
 * settlement implementation, two callers.
 */
export async function harvestPendingOutputs(userId: string): Promise<void> {
  const pending = (await pendingRuns(userId)).slice(0, HARVEST_CAP)
  for (const { promptId, holdId, credits } of pending) {
    try {
      const res = await fetch(`${MAIN_ENGINE}/history/${promptId}`)
      if (!res.ok) continue
      const hist = await res.json() as Record<string, any>
      const status = hist[promptId]?.status
      if (status?.status_str === 'success' && status.completed) {
        await settleGraphSuccess(MAIN_ENGINE, promptId, holdId, credits)
      }
    } catch (e) {
      console.error('[engineGate] harvest failed for pending run', { promptId, error: e })
    }
  }
}
