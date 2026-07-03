/**
 * Correlate a graph run to its outcome by polling GET /history/{prompt_id}.
 * We poll (not websocket) because ComfyUI sends execution_success only to the
 * submitting client_id, not broadcast (execution.py:793 → add_message
 * broadcast=False → execution.py:680). All I/O is injected so this is a pure,
 * fast unit. Debit-on-success only: an error OR a timeout calls onError.
 */
export interface HistoryEntry { status?: { status_str?: 'success' | 'error'; completed?: boolean } }

export interface SettleOpts {
  promptId: string
  pollHistory: (promptId: string) => Promise<HistoryEntry | null>
  onSuccess: (promptId: string) => void
  onError: (promptId: string) => void
  sleep?: (ms: number) => Promise<void>
  intervalMs?: number
  maxPolls?: number
}

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function settleOnCompletion(opts: SettleOpts): Promise<'success' | 'error' | 'timeout'> {
  const { promptId, pollHistory, onSuccess, onError } = opts
  const sleep = opts.sleep ?? realSleep
  const intervalMs = opts.intervalMs ?? 1000
  const maxPolls = opts.maxPolls ?? 120

  for (let n = 0; n < maxPolls; n++) {
    let entry: HistoryEntry | null = null
    try {
      entry = await pollHistory(promptId)
    } catch { /* transient poll failure — keep polling; maxPolls timeout is the backstop */ }
    if (entry?.status?.completed) {
      if (entry.status.status_str === 'success') { onSuccess(promptId); return 'success' }
      onError(promptId); return 'error'
    }
    await sleep(intervalMs)
  }
  onError(promptId) // never charge a run we could not confirm
  return 'timeout'
}
