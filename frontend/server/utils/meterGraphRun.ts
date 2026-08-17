/**
 * Stage 5 Task 4: the metered graph submission path. In hosted mode the
 * comfyui-proxy middleware routes POST /prompt here instead of raw-proxying
 * (local mode falls through to the raw proxy unchanged). Invariants:
 * (1) hold BEFORE forward — an underfunded run never reaches the engine;
 * (2) ComfyUI's response body passes through VERBATIM (clients parse
 *     prompt_id / node_errors from the real shape);
 * (3) settlement is watcher-driven: settle the hold + record output filenames
 *     on success, release the hold on error/timeout. Refusals cost nothing.
 */
import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { priceGraph, UnpricedGraphError } from './priceBook'
import { MeterRefusalError } from './requestMeter'
import { createGraphRun, resolveGraphRun, outputKey } from './graphRuns'
import { settleOnCompletion } from './settleWatcher'
import { stripForeignComfyOrgCreds } from './spikeAuth'
import { resolveWorkerTarget } from './workerRoute'
import { getLiveLedger } from './ledgerLive'

export function isPromptPath(path: string): boolean {
  return path === '/prompt' || path.startsWith('/prompt?')
}

export interface GraphRunDeps {
  priceGraph: typeof priceGraph
  hold(userId: string, credits: number): Promise<{ ok: true; holdId: number } | { ok: false; reason: 'insufficient' }>
  getAvailable(userId: string): Promise<number>
  forward(body: any): Promise<{ status: number; body: any }>
  registerRun(r: { promptId: string; userId: string; credits: number; holdId: number | null }): Promise<void>
  startSettle(r: { promptId: string; holdId: number | null; credits: number }): void
  releaseHold(holdId: number): Promise<void>
}

export async function meterGraphSubmit(userId: string | null, body: any, deps: GraphRunDeps): Promise<{ status: number; body: any }> {
  if (!userId) throw new MeterRefusalError('Sign in to run graphs', 401)
  if (!body || typeof body.prompt !== 'object' || body.prompt === null) {
    throw new MeterRefusalError('Missing prompt graph', 400)
  }

  let price
  try {
    price = deps.priceGraph(body.prompt)
  } catch (e) {
    if (e instanceof UnpricedGraphError) throw new MeterRefusalError(e.message, 500)
    throw e
  }

  let holdId: number | null = null
  if (price.credits > 0) {
    const res = await deps.hold(userId, price.credits)
    if (!res.ok) {
      const available = await deps.getAvailable(userId)
      throw new MeterRefusalError('Not enough credits', 402, { required: price.credits, available })
    }
    holdId = res.holdId
  }

  const fwd = await deps.forward(body)
  const promptId: string | undefined = fwd.body?.prompt_id
  if (fwd.status !== 200 || !promptId) {
    if (holdId !== null) await deps.releaseHold(holdId)
    return fwd // verbatim — clients parse node_errors from this exact shape
  }

  await deps.registerRun({ promptId, userId, credits: price.credits, holdId })
  deps.startSettle({ promptId, holdId, credits: price.credits })
  return fwd
}

/**
 * settleOnCompletion's default (120 polls @ 1s = 2min) is too short for
 * video-model graph runs, which can run well past 2 minutes. 30 minutes at a
 * 2s cadence covers any real run while staying well under the ledger's 2h
 * hold-sweep TTL, so a slow-but-completing run is never voided out from
 * under itself before it has a chance to settle.
 */
const SETTLE_INTERVAL_MS = 2000
const SETTLE_MAX_POLLS = 900

export async function handleMeteredPrompt(event: H3Event): Promise<any> {
  const userId = event.context.userId ?? null
  const body = await readBody(event)
  const { port } = resolveWorkerTarget(event.path)
  const target = `http://127.0.0.1:${port}`
  const ledger = getLiveLedger()

  const result = await meterGraphSubmit(userId, body, {
    priceGraph,
    hold: async (u, credits) => {
      const r = await ledger.hold(u, credits, `graph:${randomUUID()}`)
      return r.ok ? { ok: true, holdId: r.holdId } : { ok: false, reason: 'insufficient' }
    },
    getAvailable: u => ledger.getAvailable(u),
    forward: async (b) => {
      const safe = { ...b, extra_data: stripForeignComfyOrgCreds(b?.extra_data, null) }
      const res = await fetch(`${target}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: target },
        body: JSON.stringify(safe),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    },
    registerRun: createGraphRun,
    startSettle: ({ promptId, holdId, credits }) => {
      void settleOnCompletion({
        promptId,
        intervalMs: SETTLE_INTERVAL_MS,
        maxPolls: SETTLE_MAX_POLLS,
        pollHistory: async (id) => {
          const r = await fetch(`${target}/history/${id}`)
          if (!r.ok) return null
          const hist = await r.json() as Record<string, any>
          return hist[id] ?? null
        },
        onSuccess: (id) => { void settleGraphSuccess(target, id, holdId, credits) },
        onError: (id) => {
          void (async () => {
            if (holdId !== null) await ledger.release(holdId).catch(e => console.error('[graphMeter] release failed', { id, holdId, e }))
            await resolveGraphRun(id, 'voided').catch(() => {})
          })()
        },
      })
    },
    releaseHold: id => ledger.release(id),
  })

  setResponseStatus(event, result.status)
  return result.body
}

async function settleGraphSuccess(target: string, promptId: string, holdId: number | null, credits: number): Promise<void> {
  const outputs: string[] = []
  try {
    const r = await fetch(`${target}/history/${promptId}`)
    if (r.ok) {
      const hist = await r.json() as Record<string, any>
      const nodeOutputs = hist[promptId]?.outputs ?? {}
      for (const node of Object.values(nodeOutputs) as any[]) {
        for (const arr of [node?.images, node?.gifs, node?.videos, node?.audio]) {
          if (!Array.isArray(arr)) continue
          for (const f of arr) if (f?.filename) outputs.push(outputKey(f))
        }
      }
    }
  } catch (e) { console.error('[graphMeter] output harvest failed', { promptId, e }) }

  if (holdId !== null) {
    try {
      const s = await getLiveLedger().settle(holdId, credits, `graph:${promptId}`)
      if (!s.settled) console.error('[graphMeter] SETTLE ON RELEASED HOLD — run shipped uncharged', { promptId, holdId, credits })
    } catch (e) {
      console.error('[graphMeter] SETTLE FAILED after successful run', { promptId, holdId, credits, e })
    }
  }
  await resolveGraphRun(promptId, 'settled', outputs).catch(e => console.error('[graphMeter] resolve failed', { promptId, e }))
}
