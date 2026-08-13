/**
 * POST /api/meter/prompt — the authenticated Surface-B choke point (spike).
 * Wires the real deps into meterPrompt(): stub auth, price book, mock ledger,
 * pending-charge store, forward-to-ComfyUI, and the history-poll watcher that
 * debits on success. In production this route (or its middleware form) is the
 * ONLY way a graph reaches the engine; see the isolation note in the findings doc.
 */
import { meterPrompt, MeterError } from '~~/server/utils/meterPrompt'
import { priceGraph } from '~~/server/utils/priceBook'
import { meterStore } from '~~/server/utils/meterStore'
import { settleOnCompletion } from '~~/server/utils/settleWatcher'
import { resolveSpikeUser, stripForeignComfyOrgCreds } from '~~/server/utils/spikeAuth'
import { deployMode } from '~~/server/utils/deployMode'
import { buildLedgerAdapters } from '~~/server/utils/meterWiring'
import { getLiveLedger } from '~~/server/utils/ledgerLive'

const COMFY = 'http://127.0.0.1:8188'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const mode = deployMode()
  // Hosted: the middleware attached the Clerk user. Local: spike header as before.
  const userId = mode === 'hosted'
    ? (event.context.userId ?? null)
    : resolveSpikeUser(getHeaders(event) as Record<string, string | undefined>)

  const adapters = buildLedgerAdapters(mode, mode === 'hosted' ? getLiveLedger() : undefined)

  const deps = {
    priceGraph,
    getAvailable: (u: string) => adapters.getAvailable(u),
    register: (promptId: string, charge: { userId: string; credits: number; version: string }) =>
      meterStore.register(promptId, charge),
    forward: async (b: any) => {
      // Spike policy: strip EVERY comfy.org credential — there is no trusted
      // per-user key store yet, so nothing in the body can be verified as "the
      // caller's own key". Phase 1 (Clerk) re-enables §7 pass-through by
      // passing the user's stored key from their session as callerSuppliedKey.
      const safeBody = { ...b, extra_data: stripForeignComfyOrgCreds(b?.extra_data, null) }
      const res = await fetch(`${COMFY}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: COMFY },
        body: JSON.stringify(safeBody),
      })
      if (!res.ok) throw new MeterError('bad_request', `ComfyUI rejected the prompt (${res.status})`)
      return await res.json() as { prompt_id: string }
    },
    settle: (promptId: string, u: string, credits: number, version: string) => {
      void settleOnCompletion({
        promptId,
        pollHistory: async (id) => {
          const r = await fetch(`${COMFY}/history/${id}`)
          if (!r.ok) return null
          const hist = await r.json() as Record<string, any>
          return hist[id] ?? null
        },
        onSuccess: (id) => {
          void adapters.debitOnSuccess(u, credits, version, id)
            .then(r => meterStore.resolve(id, r.ok ? 'settled' : 'voided'))
            .catch((e) => {
              // Job ran but the charge failed — money bug, must be loud.
              console.error('[meter] DEBIT FAILED after successful run', { promptId: id, user: u, credits }, e)
              meterStore.resolve(id, 'voided')
            })
        },
        onError: (id) => meterStore.resolve(id, 'voided'),
      })
    },
  }

  try {
    return await meterPrompt(userId, body, deps)
  }
  catch (err) {
    if (err instanceof MeterError) {
      const status = err.code === 'unauthorized' ? 401 : err.code === 'insufficient' ? 402 : 400
      throw createError({ statusCode: status, message: err.message, data: { code: err.code, available: err.available, required: err.required } })
    }
    throw err
  }
})
