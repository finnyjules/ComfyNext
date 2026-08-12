/**
 * Observational spend log (consumer-product roadmap, Stage-4 prep). Appends
 * one JSONL line per provider job so local usage produces the consumption
 * data the pricing decisions need. Observation only — it never gates and
 * NEVER throws: a logging failure must not break a paid render that already
 * succeeded. The ledger (ledger.ts) is enforcement; this is the flight recorder.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SpendEvent {
  provider: 'replicate' | 'fal' | 'anthropic'
  model: string
  ok: boolean
  ms?: number
}

export function spendLogPath(): string {
  return process.env.SAILOR_SPEND_LOG || join(process.cwd(), '.data', 'spend-events.jsonl')
}

// Serialize writes behind one chained promise so concurrent logSpend() calls
// append in call order — two independent mkdir().then(appendFile) chains can
// otherwise interleave (mkdir is an async fs op even when the dir exists),
// scrambling line order under back-to-back calls.
let writeChain: Promise<void> = Promise.resolve()

export function logSpend(event: SpendEvent): void {
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`
  const path = spendLogPath()
  writeChain = writeChain
    .then(() => mkdir(dirname(path), { recursive: true }))
    .then(() => appendFile(path, line, 'utf8'))
    .catch(() => {}) // fire-and-forget by design
}
