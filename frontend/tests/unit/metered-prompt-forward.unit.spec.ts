/**
 * Stage 5 security review I2 + I4 — the hosted forward path.
 *
 * I2 (client-chosen prompt_id): ComfyUI honours `json_data.prompt_id` if the
 * submitter supplies one. An attacker who learns a victim's prompt_id can
 * submit their OWN graph carrying it; ComfyUI runs it under that id, the
 * attacker's settle watcher then calls resolveGraphRun(id, 'settled',
 * <attacker outputs>) — an UPDATE keyed on prompt_id alone — and overwrites
 * the victim's graph_runs row, revoking the victim's access to their own
 * outputs and granting it to the attacker's. The forwarded body must never
 * carry a client-chosen prompt_id.
 *
 * I4 (pool-worker runs unharvestable): graph_runs recorded no engine, so the
 * /view race-window harvest always polled :8188 and could never settle a run
 * dispatched to a pool worker. createGraphRun must record the target.
 *
 * Drives the real handleMeteredPrompt with a stubbed engine + ledger.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('h3', async (orig) => {
  const actual = await orig() as any
  return { ...actual, readBody: async (event: any) => event.body, setResponseStatus: () => {} }
})

const createGraphRun = vi.fn(async () => {})
vi.mock('../../server/utils/graphRuns', async (orig) => {
  const actual = await orig() as any
  return { ...actual, createGraphRun: (...a: any[]) => createGraphRun(...(a as [])), resolveGraphRun: async () => {} }
})

vi.mock('../../server/utils/settleWatcher', () => ({ settleOnCompletion: vi.fn(async () => 'success') }))

const ledger = {
  hold: vi.fn(async () => ({ ok: true as const, holdId: 7 })),
  getAvailable: vi.fn(async () => 1000),
  release: vi.fn(async () => {}),
  settle: vi.fn(async () => ({ settled: true })),
}
vi.mock('../../server/utils/ledgerLive', () => ({ getLiveLedger: () => ledger }))

const fetchMock = vi.fn(async (_url: string, _init?: any) => ({
  ok: true,
  status: 200,
  json: async () => ({ prompt_id: 'engine-assigned', number: 1, node_errors: {} }),
}))
;(globalThis as any).fetch = fetchMock

let handleMeteredPrompt: (event: any) => Promise<any>
let settleGraphSuccess: (target: string, promptId: string, holdId: number | null, credits: number) => Promise<void>
beforeAll(async () => { ({ handleMeteredPrompt, settleGraphSuccess } = await import('../../server/utils/meterGraphRun')) })

beforeEach(() => { fetchMock.mockClear(); createGraphRun.mockClear() })

const GRAPH = { '1': { class_type: 'SaveImage', inputs: {} } }

function ev(body: any, path = '/prompt') {
  return { path, method: 'POST', body, context: { userId: 'u1' }, node: { req: {}, res: {} } }
}
function forwardedBody(): any {
  const call = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/prompt'))
  return JSON.parse((call?.[1] as any).body)
}

describe('I2 — a client-chosen prompt_id is never forwarded', () => {
  it('strips prompt_id from the forwarded body', async () => {
    await handleMeteredPrompt(ev({ prompt: GRAPH, client_id: 'c1', prompt_id: 'victims-run-id' }))
    const sent = forwardedBody()
    expect('prompt_id' in sent, 'forwarded body must not carry prompt_id').toBe(false)
    expect(sent.prompt).toEqual(GRAPH)
    expect(sent.client_id).toBe('c1')
  })

  it('ownership is recorded under the ENGINE-assigned id, not the submitted one', async () => {
    await handleMeteredPrompt(ev({ prompt: GRAPH, prompt_id: 'victims-run-id' }))
    expect(createGraphRun.mock.calls[0][0]).toMatchObject({ promptId: 'engine-assigned', userId: 'u1' })
  })

  it('leaves a body with no prompt_id alone', async () => {
    await handleMeteredPrompt(ev({ prompt: GRAPH, client_id: 'c1' }))
    expect(forwardedBody()).toMatchObject({ prompt: GRAPH, client_id: 'c1' })
  })
})

describe('M6 — the promptId is percent-encoded into the history path', () => {
  it('encodes in the settlement harvest', async () => {
    await settleGraphSuccess('http://127.0.0.1:8188', 'a b/../c', null, 0)
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8188/history/a%20b%2F..%2Fc')
  })
})

describe('I4 — the run records which engine ran it', () => {
  it('records the main engine for an unrouted submission', async () => {
    await handleMeteredPrompt(ev({ prompt: GRAPH }))
    expect(createGraphRun.mock.calls[0][0]).toMatchObject({ target: 'http://127.0.0.1:8188' })
  })

  it('records the pool worker when ?comfyWorker=N routed the run', async () => {
    await handleMeteredPrompt(ev({ prompt: GRAPH }, '/prompt?comfyWorker=2'))
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8191/prompt')
    expect(createGraphRun.mock.calls[0][0]).toMatchObject({ target: 'http://127.0.0.1:8191' })
  })
})
