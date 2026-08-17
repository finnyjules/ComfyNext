/**
 * Stage 5 security review C1: ComfyUI mirrors EVERY route under `/api/`
 * (server.py registers both `path` and `"/api" + path`), and comfyui-proxy
 * strips a leading `/comfyui` before proxying. So every hosted tenant gate
 * added in Task 5 — metered /prompt, the /queue filter, the /interrupt
 * ownership check, the /history + /view Nitro routes — had an alias form
 * that walked straight past it into the raw proxy:
 *
 *   /api/prompt        → UNMETERED graph runs
 *   /api/queue         → every tenant's queue
 *   /api/interrupt     → cancel anyone's run
 *   /api/history       → every tenant's prompts + output filenames
 *   /api/view          → every tenant's pixels
 *   /comfyui/<same>    → same, via the /comfyui base SettingsModal uses
 *   /comfyui/api/queue → both aliases stacked
 *   /comfyui/internal/files/output → filename enumeration oracle
 *
 * These tests drive the REAL middleware (default export of
 * server/middleware/comfyui-proxy.ts) with fake events, so they fail against
 * the pre-fix tree rather than merely asserting a new helper's return value.
 *
 * Local mode is the other half of the contract: normalization runs but every
 * decision must still fall through to the raw proxy with a byte-identical
 * target, so a local install is untouched by any of this.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Nitro auto-imports used at module scope / inside the handler.
const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.createError = (opts: { statusCode: number, message?: string, statusMessage?: string }) => {
  const err = new Error(opts.message ?? opts.statusMessage) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
}
const proxyRequest = vi.fn(async (_event: any, url: string, _opts?: any) => ({ proxiedTo: url }))
g.proxyRequest = proxyRequest

let mode: 'local' | 'hosted' = 'local'
vi.mock('../../server/utils/deployMode', () => ({
  deployMode: () => mode,
  isHosted: () => mode === 'hosted',
}))

const handleMeteredPrompt = vi.fn(async () => ({ handler: 'metered' }))
vi.mock('../../server/utils/meterGraphRun', () => ({
  isPromptPath: (p: string) => p === '/prompt' || p.startsWith('/prompt?'),
  handleMeteredPrompt: (...a: any[]) => handleMeteredPrompt(...(a as [])),
}))

const handleHostedQueueGet = vi.fn(async () => ({ handler: 'queue' }))
const handleHostedInterrupt = vi.fn(async () => ({ handler: 'interrupt' }))
vi.mock('../../server/utils/engineGate', () => ({
  handleHostedQueueGet: (...a: any[]) => handleHostedQueueGet(...(a as [])),
  handleHostedInterrupt: (...a: any[]) => handleHostedInterrupt(...(a as [])),
}))

let middleware: (event: any) => Promise<any>
let normalizeEnginePath: (path: string) => string

beforeAll(async () => {
  middleware = (await import('../../server/middleware/comfyui-proxy')).default as any
  ;({ normalizeEnginePath } = await import('../../server/utils/enginePath'))
})

beforeEach(() => {
  proxyRequest.mockClear()
  handleMeteredPrompt.mockClear()
  handleHostedQueueGet.mockClear()
  handleHostedInterrupt.mockClear()
})
afterEach(() => { mode = 'local' })

function ev(path: string, method = 'GET') {
  return { path, method, context: { userId: 'u1' }, node: { req: {}, res: {} } }
}
async function status(path: string, method = 'GET'): Promise<number | 'proxied' | 'passthrough' | string> {
  try {
    const res = await middleware(ev(path, method))
    if (res === undefined) return 'passthrough'
    if (proxyRequest.mock.calls.length) return 'proxied'
    return (res as any)?.handler ?? 'unknown'
  } catch (e: any) {
    return e?.statusCode ?? 'threw'
  }
}

// ---------------------------------------------------------------- pure part

describe('normalizeEnginePath', () => {
  it('leaves canonical engine paths untouched', () => {
    for (const p of ['/prompt', '/queue', '/interrupt', '/history', '/view', '/upload/image', '/object_info', '/system_stats']) {
      expect(normalizeEnginePath(p)).toBe(p)
    }
  })

  it('strips one leading /comfyui', () => {
    expect(normalizeEnginePath('/comfyui/history')).toBe('/history')
    expect(normalizeEnginePath('/comfyui/queue')).toBe('/queue')
    expect(normalizeEnginePath('/comfyui/internal/files/output')).toBe('/internal/files/output')
    expect(normalizeEnginePath('/comfyui')).toBe('/')
    expect(normalizeEnginePath('/comfyui/')).toBe('/')
  })

  it('strips one leading /api when the remainder is an engine mirror route', () => {
    expect(normalizeEnginePath('/api/history')).toBe('/history')
    expect(normalizeEnginePath('/api/prompt')).toBe('/prompt')
    expect(normalizeEnginePath('/api/queue')).toBe('/queue')
    expect(normalizeEnginePath('/api/interrupt')).toBe('/interrupt')
    expect(normalizeEnginePath('/api/view')).toBe('/view')
    expect(normalizeEnginePath('/api/internal/files/output')).toBe('/internal/files/output')
  })

  it('strips both, in order, for stacked aliases', () => {
    expect(normalizeEnginePath('/comfyui/api/queue')).toBe('/queue')
    expect(normalizeEnginePath('/comfyui/api/history/abc')).toBe('/history/abc')
  })

  it('NEVER rewrites Nitro\'s own /api namespace', () => {
    for (const p of ['/api/wallet', '/api/billing/checkout', '/api/vibe', '/api/admin/users', '/api/webhooks/clerk', '/api/pool/status']) {
      expect(normalizeEnginePath(p)).toBe(p)
    }
  })

  it('does not strip a second /api', () => {
    expect(normalizeEnginePath('/api/api/queue')).toBe('/api/api/queue')
  })

  it('preserves query strings', () => {
    expect(normalizeEnginePath('/api/view?filename=a.png&type=output')).toBe('/view?filename=a.png&type=output')
    expect(normalizeEnginePath('/comfyui/queue?comfyWorker=2')).toBe('/queue?comfyWorker=2')
    expect(normalizeEnginePath('/comfyui/api/prompt?x=1')).toBe('/prompt?x=1')
    expect(normalizeEnginePath('/api/wallet?x=1')).toBe('/api/wallet?x=1')
  })

  it('does not treat a longer sibling segment as the engine route', () => {
    expect(normalizeEnginePath('/api/viewport')).toBe('/api/viewport')
    expect(normalizeEnginePath('/api/queued')).toBe('/api/queued')
  })
})

// -------------------------------------------------------------- hosted mode

describe('hosted mode: alias forms hit the same gates as canonical paths', () => {
  beforeEach(() => { mode = 'hosted' })

  it('routes every /prompt alias through the METER, never the raw proxy', async () => {
    for (const p of ['/prompt', '/api/prompt', '/comfyui/prompt', '/comfyui/api/prompt', '/prompt?comfyWorker=1', '/api/prompt?comfyWorker=1']) {
      proxyRequest.mockClear(); handleMeteredPrompt.mockClear()
      await middleware(ev(p, 'POST'))
      expect(handleMeteredPrompt, `POST ${p} must be metered`).toHaveBeenCalledTimes(1)
      expect(proxyRequest, `POST ${p} must not raw-proxy`).not.toHaveBeenCalled()
    }
  })

  it('routes every GET /queue alias through the ownership filter', async () => {
    for (const p of ['/queue', '/api/queue', '/comfyui/queue', '/comfyui/api/queue', '/queue?comfyWorker=0']) {
      proxyRequest.mockClear(); handleHostedQueueGet.mockClear()
      await middleware(ev(p, 'GET'))
      expect(handleHostedQueueGet, `GET ${p} must be filtered`).toHaveBeenCalledTimes(1)
      expect(proxyRequest, `GET ${p} must not raw-proxy`).not.toHaveBeenCalled()
    }
  })

  it('refuses EVERY non-GET verb on every /queue alias (clear/delete wipe other tenants)', async () => {
    for (const p of ['/queue', '/api/queue', '/comfyui/queue', '/comfyui/api/queue']) {
      for (const m of ['POST', 'DELETE', 'PUT', 'PATCH']) {
        expect(await status(p, m), `${m} ${p}`).toBe(403)
      }
    }
  })

  it('routes every POST /interrupt alias through the ownership gate', async () => {
    for (const p of ['/interrupt', '/api/interrupt', '/comfyui/interrupt', '/comfyui/api/interrupt']) {
      proxyRequest.mockClear(); handleHostedInterrupt.mockClear()
      await middleware(ev(p, 'POST'))
      expect(handleHostedInterrupt, `POST ${p} must be gated`).toHaveBeenCalledTimes(1)
      expect(proxyRequest, `POST ${p} must not raw-proxy`).not.toHaveBeenCalled()
    }
  })

  it('refuses /history aliases — the canonical /history Nitro route serves the UI', async () => {
    for (const p of ['/api/history', '/comfyui/history', '/comfyui/api/history', '/api/history/abc-123', '/comfyui/history/abc-123']) {
      expect(await status(p), p).toBe(403)
    }
  })

  it('refuses /view aliases — the canonical /view Nitro route serves the UI', async () => {
    for (const p of ['/api/view?filename=a.png', '/comfyui/view?filename=a.png', '/comfyui/api/view?filename=a.png&type=output']) {
      expect(await status(p), p).toBe(403)
    }
  })

  it('refuses /internal — ComfyUI\'s file listings are a cross-tenant enumeration oracle', async () => {
    for (const p of ['/comfyui/internal/files/output', '/api/internal/files/output', '/comfyui/api/internal/files/input']) {
      expect(await status(p), p).toBe(403)
    }
  })

  it('denies unlisted engine paths by default', async () => {
    for (const p of ['/comfyui/settings', '/comfyui/userdata/x', '/comfyui/models/checkpoints', '/comfyui/free', '/comfyui/api/settings']) {
      expect(await status(p), p).toBe(403)
    }
  })

  it('still proxies the explicitly allowlisted engine paths', async () => {
    for (const [p, m] of [['/object_info', 'GET'], ['/comfyui/object_info', 'GET'], ['/system_stats', 'GET'], ['/upload/image', 'POST'], ['/extensions/foo.js', 'GET'], ['/global_subgraphs', 'GET'], ['/sailor/thing', 'GET'], ['/gate/x', 'GET']] as const) {
      proxyRequest.mockClear()
      await middleware(ev(p, m))
      expect(proxyRequest, `${m} ${p} must still proxy`).toHaveBeenCalledTimes(1)
    }
  })

  it('never diverts Nitro\'s own /api routes into the engine gates', async () => {
    for (const p of ['/api/wallet', '/api/billing/checkout', '/api/vibe', '/api/admin/x', '/api/pool/status']) {
      expect(await status(p, 'POST'), p).toBe('passthrough')
    }
    expect(handleMeteredPrompt).not.toHaveBeenCalled()
    expect(handleHostedQueueGet).not.toHaveBeenCalled()
    expect(proxyRequest).not.toHaveBeenCalled()
  })

  it('leaves the canonical /view and /history Nitro routes alone', async () => {
    expect(await status('/view?filename=a.png')).toBe('passthrough')
    expect(await status('/history')).toBe('passthrough')
    expect(await status('/history/abc')).toBe('passthrough')
  })
})

// --------------------------------------------------------------- local mode

describe('local mode is byte-identical — no gate, no 403, same proxy target', () => {
  const ALL = [
    ['/prompt', 'POST'], ['/api/prompt', 'POST'], ['/comfyui/prompt', 'POST'], ['/comfyui/api/prompt', 'POST'],
    ['/queue', 'GET'], ['/api/queue', 'GET'], ['/comfyui/queue', 'GET'], ['/comfyui/api/queue', 'GET'],
    ['/queue', 'POST'], ['/api/queue', 'DELETE'],
    ['/interrupt', 'POST'], ['/api/interrupt', 'POST'], ['/comfyui/interrupt', 'POST'],
    ['/api/history', 'GET'], ['/comfyui/history', 'GET'], ['/api/view?filename=a.png', 'GET'],
    ['/comfyui/internal/files/output', 'GET'], ['/comfyui/settings', 'GET'], ['/object_info', 'GET'],
  ] as const

  it('proxies every path the hosted gates intercept', async () => {
    for (const [p, m] of ALL) {
      proxyRequest.mockClear()
      await middleware(ev(p, m))
      expect(proxyRequest, `${m} ${p} must raw-proxy in local mode`).toHaveBeenCalledTimes(1)
    }
    expect(handleMeteredPrompt).not.toHaveBeenCalled()
    expect(handleHostedQueueGet).not.toHaveBeenCalled()
    expect(handleHostedInterrupt).not.toHaveBeenCalled()
  })

  it('sends the pre-Stage-5 target URL for each alias (normalization must not reach the proxy)', async () => {
    const expected: [string, string][] = [
      ['/api/prompt', 'http://127.0.0.1:8188/api/prompt'],
      ['/api/queue', 'http://127.0.0.1:8188/api/queue'],
      ['/api/history', 'http://127.0.0.1:8188/api/history'],
      ['/comfyui/history', 'http://127.0.0.1:8188/history'],
      ['/comfyui/api/queue', 'http://127.0.0.1:8188/api/queue'],
      ['/comfyui/internal/files/output', 'http://127.0.0.1:8188/internal/files/output'],
      ['/comfyui/settings', 'http://127.0.0.1:8188/settings'],
      ['/queue?comfyWorker=2', 'http://127.0.0.1:8191/queue'],
      ['/comfyui', 'http://127.0.0.1:8188/'],
    ]
    for (const [p, url] of expected) {
      proxyRequest.mockClear()
      await middleware(ev(p, 'GET'))
      expect(proxyRequest.mock.calls[0]?.[1], p).toBe(url)
    }
  })
})
