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
const handleHostedObjectInfo = vi.fn(async () => ({ handler: 'objectInfo' }))
const handleHostedUpload = vi.fn(async () => ({ handler: 'upload' }))
vi.mock('../../server/utils/engineGate', () => ({
  handleHostedQueueGet: (...a: any[]) => handleHostedQueueGet(...(a as [])),
  handleHostedInterrupt: (...a: any[]) => handleHostedInterrupt(...(a as [])),
  handleHostedObjectInfo: (...a: any[]) => handleHostedObjectInfo(...(a as [])),
  handleHostedUpload: (...a: any[]) => handleHostedUpload(...(a as [])),
}))

let middleware: (event: any) => Promise<any>
let normalizeEnginePath: (path: string) => string
let hostedEngineDecision: (p: string, m: string) => { kind: string, message?: string }

beforeAll(async () => {
  middleware = (await import('../../server/middleware/comfyui-proxy')).default as any
  ;({ normalizeEnginePath, hostedEngineDecision } = await import('../../server/utils/enginePath'))
})

beforeEach(() => {
  proxyRequest.mockClear()
  handleMeteredPrompt.mockClear()
  handleHostedQueueGet.mockClear()
  handleHostedInterrupt.mockClear()
  handleHostedObjectInfo.mockClear()
  handleHostedUpload.mockClear()
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

  // F6 — every gate is a PREFIX match, so a dot segment inside an ALLOWED
  // prefix would carry a refused path past its refusal. Nitro folds these
  // upstream today, but that is an undocumented invariant of someone else's
  // router; this makes the guarantee local to the function that depends on it.
  describe('F6: dot segments are folded before any prefix is matched', () => {
    it('folds `..` out of an allowlisted prefix', () => {
      expect(normalizeEnginePath('/extensions/../history')).toBe('/history')
      expect(normalizeEnginePath('/extensions/../internal/files/output')).toBe('/internal/files/output')
      expect(normalizeEnginePath('/system_stats/../queue')).toBe('/queue')
    })

    it('folds percent-encoded dot segments', () => {
      expect(normalizeEnginePath('/extensions/%2e%2e/history')).toBe('/history')
      expect(normalizeEnginePath('/extensions/%2E%2E/history')).toBe('/history')
      expect(normalizeEnginePath('/extensions/%2e/history')).toBe('/extensions/history')
    })

    it('folds before the alias strips, not after', () => {
      expect(normalizeEnginePath('/comfyui/extensions/../history')).toBe('/history')
      expect(normalizeEnginePath('/comfyui/api/extensions/../queue')).toBe('/queue')
    })

    it('preserves the query string verbatim through canonicalization', () => {
      // URL.search would re-encode this; callers forward the RAW path, so the
      // two must not drift.
      expect(normalizeEnginePath('/extensions/../view?filename=a b.png')).toBe('/view?filename=a b.png')
    })

    it('leaves an ENCODED separator alone — `..%2f` is one literal segment', () => {
      // aiohttp reads it the same way, so folding it here would make the gate
      // and the engine disagree about which path was requested.
      expect(normalizeEnginePath('/extensions/..%2fhistory')).toBe('/extensions/..%2fhistory')
    })
  })
})

describe('F6: a dot-segment path is REFUSED, not proxied', () => {
  beforeEach(() => { mode = 'hosted' })

  it('refuses paths that fold onto a gated engine route', async () => {
    for (const p of ['/extensions/../history', '/extensions/%2e%2e/history', '/comfyui/extensions/../history', '/extensions/../internal/files/output', '/extensions/../gate/resume']) {
      expect(await status(p), p).toBe(403)
    }
    expect(proxyRequest).not.toHaveBeenCalled()
  })

  it('still gates — not proxies — a dot-segment path that folds onto /queue', async () => {
    await middleware(ev('/extensions/../queue', 'GET'))
    expect(handleHostedQueueGet).toHaveBeenCalledTimes(1)
    expect(proxyRequest).not.toHaveBeenCalled()
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

  // ROUND 2 — these expectations MOVED, and the move is the lesson.
  //
  // This block used to assert that /object_info, /upload and /gate raw-proxy,
  // which read as a specification of the allowlist but was really just an echo
  // of it: the test was written from the LIST, not from what the upstream
  // handlers do. Both of the entries that looked most inert turned out to be
  // the two worst holes in the tenant boundary (F1, F2).
  //
  // So: an allowlist entry is a claim about a HANDLER, and adding one requires
  // reading that handler in ComfyUI's server.py — what does it read, what does
  // it write, whose data is in scope? "It's a static GET" is not an audit.
  it('still raw-proxies the engine paths that survived the round-2 handler audit', async () => {
    for (const [p, m] of [['/system_stats', 'GET'], ['/extensions/foo.js', 'GET'], ['/global_subgraphs', 'GET'], ['/sailor/thing', 'GET']] as const) {
      proxyRequest.mockClear()
      await middleware(ev(p, m))
      expect(proxyRequest, `${m} ${p} must still proxy`).toHaveBeenCalledTimes(1)
    }
  })

  // F1: POST /gate/resume takes a client-supplied prompt_id, rebuilds the
  // STORED graph and re-queues it under a fresh uuid — unmetered arbitrary
  // re-execution, with no hold, no price and no graph_runs row — while popping
  // another tenant's paused-gate context. Metered resume is a future task.
  it('F1: refuses EVERY /gate alias — unmetered re-execution of a stored graph', async () => {
    for (const p of ['/gate', '/gate/resume', '/comfyui/gate/resume', '/api/gate/resume', '/comfyui/api/gate/resume']) {
      for (const m of ['POST', 'GET']) {
        expect(await status(p, m), `${m} ${p}`).toBe(403)
      }
    }
    expect(proxyRequest, '/gate must never reach the engine').not.toHaveBeenCalled()
  })

  it('F1: the decision itself forbids /gate, canonical and aliased', () => {
    for (const p of ['/gate/resume', '/comfyui/gate/resume', '/api/gate/resume']) {
      expect(hostedEngineDecision(normalizeEnginePath(p), 'POST').kind, p).toBe('forbid')
    }
  })

  // F2: /object_info embeds the SHARED input-directory listing in every
  // LoadImage-family combo. The canvas needs the schemas, so it is scrubbed
  // rather than refused — but it must never raw-proxy.
  it('F2: routes every GET /object_info alias through the scrubber', async () => {
    for (const p of ['/object_info', '/object_info/LoadImage', '/comfyui/object_info', '/api/object_info', '/comfyui/api/object_info', '/object_info?comfyWorker=2']) {
      proxyRequest.mockClear(); handleHostedObjectInfo.mockClear()
      await middleware(ev(p, 'GET'))
      expect(handleHostedObjectInfo, `GET ${p} must be scrubbed`).toHaveBeenCalledTimes(1)
      expect(proxyRequest, `GET ${p} must not raw-proxy`).not.toHaveBeenCalled()
    }
  })

  it('F2: refuses non-GET verbs on /object_info', async () => {
    for (const m of ['POST', 'DELETE', 'PUT']) {
      expect(await status('/object_info', m), m).toBe(403)
    }
  })

  // F4: ComfyUI's image_upload() honours an `overwrite` form field and the
  // input dir is shared, so the body must be inspected before it is forwarded.
  it('F4: routes every POST /upload alias through the overwrite gate', async () => {
    for (const p of ['/upload/image', '/upload/mask', '/comfyui/upload/image', '/api/upload/image', '/comfyui/api/upload/image']) {
      proxyRequest.mockClear(); handleHostedUpload.mockClear()
      await middleware(ev(p, 'POST'))
      expect(handleHostedUpload, `POST ${p} must be gated`).toHaveBeenCalledTimes(1)
      expect(proxyRequest, `POST ${p} must not raw-proxy`).not.toHaveBeenCalled()
    }
  })

  it('F4: refuses non-POST verbs on /upload', async () => {
    for (const m of ['GET', 'DELETE']) {
      expect(await status('/upload/image', m), m).toBe(403)
    }
  })

  // F8: this 403 used to be handed the /queue message verbatim.
  it('F8: the non-POST /prompt refusal names /prompt, not the queue', () => {
    const d = hostedEngineDecision('/prompt', 'GET') as { kind: string, message: string }
    expect(d.kind).toBe('forbid')
    expect(d.message).toContain('/prompt')
    expect(d.message).not.toContain('queue')
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
    // Round 2: the three prefixes that stopped raw-proxying in HOSTED mode
    // must still raw-proxy locally — no scrubber, no overwrite sniff, no 403.
    ['/comfyui/object_info', 'GET'], ['/upload/image', 'POST'], ['/gate/resume', 'POST'],
    ['/extensions/../history', 'GET'],
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
