/**
 * Stage 6 Task 2 — the `/sailor` projects extension is tenant-gated.
 *
 * THE LIVE P0 THIS CLOSES: `/sailor` sat on `HOSTED_RAW_ALLOW`, so every route
 * in `comfy_extras/nodes_sailor_projects.py` was reachable RAW by any signed-in
 * hosted user. Those handlers take the project uuid straight off the path and
 * check exactly one thing — `_is_safe_id` (path traversal). There is no
 * identity in the request at all, and no identity on disk. So a signed-in
 * tenant could:
 *
 *   GET    /sailor/projects              → every tenant's project index
 *   GET    /sailor/projects/<uuid>       → someone else's graph, verbatim
 *   PUT    /sailor/projects/<uuid>       → rename someone else's project
 *   DELETE /sailor/projects/<uuid>       → destroy it
 *   POST   /sailor/projects/<uuid>/versions → overwrite their rolling save
 *   GET    /sailor/spend/summary         → the whole install's spend ledger
 *
 * This is the product's saved-work store, so the gate is written like security
 * code: fail closed, and a resource the caller does not own answers 404 rather
 * than 403 — a 403 would confirm the uuid exists, turning the gate into an
 * enumeration oracle for the very ids it protects.
 *
 * PROJECTS ARE PERSONAL. The Stage-6 "unowned = curated/global, readable by
 * all" rule (resourceOwners.hostedCanRead) deliberately does NOT apply here:
 * an unowned project is somebody's orphaned saved work, not house content, so
 * it is invisible in the list and 404s on read. The only thing an unowned uuid
 * permits is a WRITE that creates it (that is how a brand-new project is born;
 * a project owned by anyone else refuses the same write).
 *
 * These tests drive the REAL middleware and the REAL handler (the harness from
 * engine-upload-ownership.unit.spec.ts) with a faked ownership table and a
 * faked engine fetch, so they fail against the pre-fix tree instead of merely
 * describing a new helper.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rawBody = vi.fn(async () => undefined as Buffer | undefined)
const requestHeader = vi.fn((_e: any, _n: string) => undefined as string | undefined)
vi.mock('h3', async (orig) => {
  const actual = await orig() as any
  return {
    ...actual,
    readRawBody: (...a: any[]) => rawBody(...(a as [])),
    getRequestHeader: (...a: any[]) => requestHeader(...(a as [any, string])),
    setResponseStatus: (_e: any, s: number) => { lastStatus = s },
  }
})

let lastStatus = 0

let mode: 'local' | 'hosted' = 'hosted'
vi.mock('../../server/utils/deployMode', () => ({
  deployMode: () => mode,
  isHosted: () => mode === 'hosted',
}))

// Nitro auto-imports the real middleware uses at module scope.
const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.createError = (o: { statusCode: number, message?: string, statusMessage?: string }) => {
  const err = new Error(o.message ?? o.statusMessage) as Error & { statusCode: number }
  err.statusCode = o.statusCode
  return err
}
const proxyRequest = vi.fn(async (_e: any, url: string) => ({ proxiedTo: url }))
g.proxyRequest = proxyRequest

const { handleHostedSailor, sailorProjectsRoute } = await import('../../server/utils/engineGate')
const { hostedEngineDecision, normalizeEnginePath } = await import('../../server/utils/enginePath')
const { __setResourceOwnersDbForTests } = await import('../../server/utils/resourceOwners')
const middleware = (await import('../../server/middleware/comfyui-proxy')).default as any

// ---------------------------------------------------------------- fake table

const owners = new Map<string, string>()
const queries: string[] = []
const key = (kind: string, id: string) => `${kind}::${id}`

__setResourceOwnersDbForTests({
  async query(sql: string, params: unknown[] = []) {
    queries.push(sql)
    if (/insert\s+into\s+resource_owners/i.test(sql)) {
      const [kind, id, user] = params as string[]
      if (!owners.has(key(kind, id))) owners.set(key(kind, id), user) // ON CONFLICT DO NOTHING
      return { rows: [] }
    }
    if (/delete\s+from\s+resource_owners/i.test(sql)) {
      const [kind, id] = params as string[]
      owners.delete(key(kind, id))
      return { rows: [] }
    }
    if (/select\s+user_id\s+from\s+resource_owners/i.test(sql)) {
      const [kind, id] = params as string[]
      const u = owners.get(key(kind, id))
      return { rows: u ? [{ user_id: u }] : [] }
    }
    if (/select\s+resource_id\s+from\s+resource_owners/i.test(sql)) {
      const [kind, user] = params as string[]
      const rows = [...owners.entries()]
        .filter(([k, u]) => k.startsWith(`${kind}::`) && u === user)
        .map(([k]) => ({ resource_id: k.slice(kind.length + 2) }))
      return { rows }
    }
    throw new Error(`unexpected sql: ${sql}`)
  },
})

const fetchMock = vi.fn()
;(globalThis as any).fetch = fetchMock

/** Upstream answers with this JSON + status unless a test overrides it. */
function upstream(body: unknown, status = 200) {
  fetchMock.mockResolvedValue({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) })
}

beforeEach(() => {
  mode = 'hosted'
  fetchMock.mockReset()
  upstream({ ok: true })
  proxyRequest.mockClear()
  rawBody.mockReset()
  rawBody.mockResolvedValue(undefined)
  requestHeader.mockReset()
  requestHeader.mockReturnValue(undefined)
  owners.clear()
  queries.length = 0
  lastStatus = 0
  owners.set(key('project', 'p-mine'), 'u1')
  owners.set(key('project', 'p-theirs'), 'u2')
  // 'p-orphan' deliberately has NO row — unowned.
})

function ev(path: string, method = 'GET', userId: string | null = 'u1') {
  return { path, method, context: userId ? { userId } : {}, node: { req: {}, res: {} } }
}

/** Drive the real handler; return the status code on refusal, else the body. */
async function call(path: string, method = 'GET', userId: string | null = 'u1'): Promise<any> {
  try {
    return { body: await handleHostedSailor(ev(path, method, userId) as any), status: lastStatus }
  }
  catch (e: any) {
    return { status: e?.statusCode ?? 'threw', message: e?.message }
  }
}

/** Drive the real middleware end to end (decision + handler + proxy). */
async function via(path: string, method = 'GET', userId: string | null = 'u1'): Promise<any> {
  try {
    const res = await middleware(ev(path, method, userId))
    if (res === undefined) return { status: 'passthrough' }
    if (proxyRequest.mock.calls.length) return { status: 'proxied', target: proxyRequest.mock.calls[0]?.[1] }
    return { body: res, status: lastStatus }
  }
  catch (e: any) {
    return { status: e?.statusCode ?? 'threw', message: e?.message }
  }
}

// ------------------------------------------------------------ the decision

describe('hostedEngineDecision: /sailor is no longer a blanket raw allow', () => {
  it('routes every projects route to the tenant gate', () => {
    for (const [p, m] of [
      ['/sailor/projects', 'GET'],
      ['/sailor/projects/abc', 'GET'],
      ['/sailor/projects/abc', 'PUT'],
      ['/sailor/projects/abc', 'DELETE'],
      ['/sailor/projects/abc/versions', 'POST'],
      ['/sailor/projects/abc/versions/v_1', 'GET'],
      ['/sailor/projects/abc/generations', 'POST'],
      ['/sailor/projects/abc/generations', 'GET'],
    ] as const) {
      expect(hostedEngineDecision(p, m).kind, `${m} ${p}`).toBe('sailorProjects')
    }
  })

  it('refuses the install-wide spend summary — operator data', () => {
    for (const p of ['/sailor/spend', '/sailor/spend/summary']) {
      const d = hostedEngineDecision(p, 'GET') as { kind: string, message: string }
      expect(d.kind, p).toBe('forbid')
      expect(d.message).toMatch(/operator/i)
    }
  })

  it('takes the decision on the NORMALIZED path so aliases cannot walk past it', () => {
    expect(hostedEngineDecision(normalizeEnginePath('/comfyui/sailor/projects/abc'), 'DELETE').kind).toBe('sailorProjects')
    expect(hostedEngineDecision(normalizeEnginePath('/comfyui/sailor/spend/summary'), 'GET').kind).toBe('forbid')
    // A dot segment must not carry a projects path into the raw-proxy branch.
    expect(hostedEngineDecision(normalizeEnginePath('/sailor/assets/../projects/abc'), 'DELETE').kind).toBe('sailorProjects')
  })
})

// ------------------------------------------------------------- route parsing

describe('sailorProjectsRoute — the pure path/verb table', () => {
  it('maps each engine route to its access class', () => {
    expect(sailorProjectsRoute('/sailor/projects', 'GET')).toEqual({ kind: 'list' })
    expect(sailorProjectsRoute('/sailor/projects/abc', 'GET')).toEqual({ kind: 'project', uuid: 'abc', access: 'read' })
    expect(sailorProjectsRoute('/sailor/projects/abc', 'PUT')).toEqual({ kind: 'project', uuid: 'abc', access: 'write' })
    expect(sailorProjectsRoute('/sailor/projects/abc', 'DELETE')).toEqual({ kind: 'project', uuid: 'abc', access: 'delete' })
    expect(sailorProjectsRoute('/sailor/projects/abc/versions', 'POST')).toEqual({ kind: 'project', uuid: 'abc', access: 'write' })
    expect(sailorProjectsRoute('/sailor/projects/abc/versions/v_1', 'GET')).toEqual({ kind: 'project', uuid: 'abc', access: 'read' })
    expect(sailorProjectsRoute('/sailor/projects/abc/generations', 'POST')).toEqual({ kind: 'project', uuid: 'abc', access: 'write' })
    expect(sailorProjectsRoute('/sailor/projects/abc/generations', 'GET')).toEqual({ kind: 'project', uuid: 'abc', access: 'read' })
  })

  it('rejects a verb the aiohttp route table does not serve', () => {
    for (const [p, m] of [
      ['/sailor/projects', 'PUT'], ['/sailor/projects', 'POST'], ['/sailor/projects', 'DELETE'],
      ['/sailor/projects/abc', 'POST'], ['/sailor/projects/abc', 'PATCH'],
      ['/sailor/projects/abc/versions', 'GET'], ['/sailor/projects/abc/versions', 'DELETE'],
      ['/sailor/projects/abc/versions/v_1', 'PUT'], ['/sailor/projects/abc/generations', 'DELETE'],
    ] as const) {
      expect(sailorProjectsRoute(p, m).kind, `${m} ${p}`).toBe('reject')
    }
  })

  it('rejects an unknown subroute rather than forwarding it', () => {
    for (const p of ['/sailor/projects/abc/secrets', '/sailor/projects/abc/versions/v_1/extra', '/sailor/projects/a/b/c/d']) {
      const r = sailorProjectsRoute(p, 'GET') as { kind: string, status: number }
      expect(r.kind, p).toBe('reject')
      expect(r.status, p).toBe(404)
    }
  })

  it('decodes the uuid the way aiohttp will — one resource, one ownership key', () => {
    // aiohttp percent-decodes match_info, so `%70-mine` and `p-mine` are the
    // SAME project on disk. Keying ownership off the raw segment would let the
    // encoded spelling walk past the owner check.
    expect(sailorProjectsRoute('/sailor/projects/%70-mine', 'GET')).toEqual({ kind: 'project', uuid: 'p-mine', access: 'read' })
  })

  it('refuses an id the engine would treat as unsafe, and malformed encodings', () => {
    for (const p of ['/sailor/projects/..%2fetc', '/sailor/projects/.hidden', '/sailor/projects/%2e%2e%2fx', '/sailor/projects/a%2fb', '/sailor/projects/%zz']) {
      const r = sailorProjectsRoute(p, 'GET') as { kind: string, status: number }
      expect(r.kind, p).toBe('reject')
      expect(r.status, p).toBe(400)
    }
  })
})

// -------------------------------------------------------------- the list

describe('GET /sailor/projects — the index shows only the caller\'s projects', () => {
  it('drops other tenants\' projects AND unowned ones', async () => {
    upstream({ projects: [
      { uuid: 'p-mine', name: 'Mine', cover: null, updatedAt: 3 },
      { uuid: 'p-theirs', name: 'Theirs', cover: null, updatedAt: 2 },
      { uuid: 'p-orphan', name: 'Orphan', cover: null, updatedAt: 1 },
    ] })
    const { body } = await call('/sailor/projects')
    expect(body.projects.map((p: any) => p.uuid)).toEqual(['p-mine'])
  })

  it('an UNOWNED project is invisible — projects are personal, not curated content', async () => {
    // The Stage-6 unowned-is-global READ rule (hostedCanRead) must not reach
    // this list: an orphaned project is someone's saved work.
    upstream({ projects: [{ uuid: 'p-orphan', name: 'Orphan', updatedAt: 1 }] })
    const { body } = await call('/sailor/projects')
    expect(body.projects).toEqual([])
  })

  it('preserves each surviving entry verbatim and adds no other top-level keys', async () => {
    upstream({ projects: [{ uuid: 'p-mine', name: 'Mine', cover: 'c.png', updatedAt: 7 }], secretTotals: { usd: 12 } })
    const { body } = await call('/sailor/projects')
    expect(body).toEqual({ projects: [{ uuid: 'p-mine', name: 'Mine', cover: 'c.png', updatedAt: 7 }] })
  })

  it('is empty — not unfiltered — when the caller owns nothing', async () => {
    owners.clear()
    upstream({ projects: [{ uuid: 'p-theirs' }, { uuid: 'p-orphan' }] })
    const { body } = await call('/sailor/projects')
    expect(body.projects).toEqual([])
  })

  it('fails closed on a malformed upstream payload', async () => {
    upstream({ projects: 'not-an-array' })
    const { body } = await call('/sailor/projects')
    expect(body.projects).toEqual([])
  })

  it('502s when the engine is unavailable rather than serving an unfiltered body', async () => {
    upstream({ error: 'boom' }, 500)
    expect((await call('/sailor/projects')).status).toBe(502)
  })
})

// ------------------------------------------------------- per-project reads

describe('GET /sailor/projects/<uuid> — 404 for anything not yours', () => {
  it('serves the owner\'s own project verbatim', async () => {
    upstream({ project: { uuid: 'p-mine', name: 'Mine' }, currentVersion: { id: 'current' } })
    const { body } = await call('/sailor/projects/p-mine')
    expect(body).toEqual({ project: { uuid: 'p-mine', name: 'Mine' }, currentVersion: { id: 'current' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8188/sailor/projects/p-mine')
  })

  it('404s another tenant\'s project WITHOUT touching the engine', async () => {
    const r = await call('/sailor/projects/p-theirs')
    expect(r.status).toBe(404)
    expect(r.message).not.toMatch(/permission|forbidden|owner/i) // must not confirm it exists
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('404s an unowned project — orphaned saved work is not curated content', async () => {
    expect((await call('/sailor/projects/p-orphan')).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applies the same rule to the version and generation subroutes', async () => {
    for (const p of [
      '/sailor/projects/p-theirs/versions/v_1',
      '/sailor/projects/p-theirs/generations',
      '/sailor/projects/p-orphan/versions/v_1',
      '/sailor/projects/p-orphan/generations',
    ]) {
      expect((await call(p, 'GET')).status, p).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves owned subroutes', async () => {
    upstream({ version: { id: 'v_1' } })
    expect((await call('/sailor/projects/p-mine/versions/v_1', 'GET')).body).toEqual({ version: { id: 'v_1' } })
    upstream({ generations: [{ id: 'g_1' }] })
    expect((await call('/sailor/projects/p-mine/generations', 'GET')).body).toEqual({ generations: [{ id: 'g_1' }] })
  })

  it('honours the encoded spelling of an id it does not own', async () => {
    expect((await call('/sailor/projects/%70-theirs')).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------ per-project writes

describe('PUT /sailor/projects/<uuid> — writes claim, or are refused', () => {
  it('forwards a write to a NEW uuid and records ownership on success', async () => {
    rawBody.mockResolvedValue(Buffer.from('{"name":"Fresh"}'))
    requestHeader.mockImplementation((_e: any, n: string) => (n === 'content-type' ? 'application/json' : undefined))
    upstream({ project: { uuid: 'p-new', name: 'Fresh' } })
    const { body } = await call('/sailor/projects/p-new', 'PUT')
    expect(body).toEqual({ project: { uuid: 'p-new', name: 'Fresh' } })
    expect(owners.get(key('project', 'p-new'))).toBe('u1')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('PUT')
    expect(init.headers['content-type']).toBe('application/json')
    expect(Buffer.from(init.body).toString()).toBe('{"name":"Fresh"}')
  })

  it('does NOT claim a uuid the engine refused to write', async () => {
    rawBody.mockResolvedValue(Buffer.from('{"name":"Fresh"}'))
    upstream({ error: 'bad json' }, 400)
    const r = await call('/sailor/projects/p-new', 'PUT')
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'bad json' })
    expect(owners.has(key('project', 'p-new'))).toBe(false)
  })

  it('404s a write to another tenant\'s project, engine untouched', async () => {
    rawBody.mockResolvedValue(Buffer.from('{"name":"pwned"}'))
    expect((await call('/sailor/projects/p-theirs', 'PUT')).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(owners.get(key('project', 'p-theirs'))).toBe('u2')
  })

  it('lets the owner keep writing without re-claiming', async () => {
    rawBody.mockResolvedValue(Buffer.from('{"name":"Renamed"}'))
    upstream({ project: { uuid: 'p-mine' } })
    expect((await call('/sailor/projects/p-mine', 'PUT')).body).toEqual({ project: { uuid: 'p-mine' } })
    expect(owners.get(key('project', 'p-mine'))).toBe('u1')
  })

  it('applies the identical rule to version + generation POSTs (they ensure_project too)', async () => {
    rawBody.mockResolvedValue(Buffer.from('{"version":{"id":"current"}}'))
    // another tenant's project: refused, engine untouched
    for (const p of ['/sailor/projects/p-theirs/versions', '/sailor/projects/p-theirs/generations']) {
      expect((await call(p, 'POST')).status, p).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    // a brand-new uuid: the subroute CREATES the project upstream, so it must
    // claim it — otherwise the project stays unowned and invisible forever.
    upstream({ id: 'v_1' })
    expect((await call('/sailor/projects/p-fresh/versions', 'POST')).body).toEqual({ id: 'v_1' })
    expect(owners.get(key('project', 'p-fresh'))).toBe('u1')
    // and the owner's own project keeps working
    expect((await call('/sailor/projects/p-mine/generations', 'POST')).body).toEqual({ id: 'v_1' })
  })

  it('passes an upstream 409 (stale rolling write) through verbatim', async () => {
    rawBody.mockResolvedValue(Buffer.from('{"version":{"id":"current"}}'))
    upstream({ error: 'stale', storedSavedAt: 42 }, 409)
    const r = await call('/sailor/projects/p-mine/versions', 'POST')
    expect(r.status).toBe(409)
    expect(r.body).toEqual({ error: 'stale', storedSavedAt: 42 })
  })
})

describe('DELETE /sailor/projects/<uuid>', () => {
  it('forwards the owner\'s delete and releases the ownership row', async () => {
    upstream({ ok: true })
    expect((await call('/sailor/projects/p-mine', 'DELETE')).body).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
    expect(owners.has(key('project', 'p-mine'))).toBe(false)
  })

  it('404s another tenant\'s project and an unowned one, engine untouched', async () => {
    for (const p of ['/sailor/projects/p-theirs', '/sailor/projects/p-orphan']) {
      expect((await call(p, 'DELETE')).status, p).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(owners.get(key('project', 'p-theirs'))).toBe('u2')
  })

  it('keeps the ownership row when the engine refused the delete', async () => {
    upstream({ error: 'nope' }, 500)
    expect((await call('/sailor/projects/p-mine', 'DELETE')).status).toBe(500)
    expect(owners.get(key('project', 'p-mine'))).toBe('u1')
  })
})

// ---------------------------------------------------------------- envelope

describe('the gate\'s envelope: auth, verbs, worker targeting', () => {
  it('401s an unauthenticated caller before any ownership lookup', async () => {
    expect((await call('/sailor/projects', 'GET', null)).status).toBe(401)
    expect(queries).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('405s a verb the engine does not serve — never a raw proxy', async () => {
    for (const [p, m] of [['/sailor/projects', 'DELETE'], ['/sailor/projects/p-mine', 'POST'], ['/sailor/projects/p-mine/versions', 'DELETE']] as const) {
      expect((await call(p, m)).status, `${m} ${p}`).toBe(405)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(proxyRequest).not.toHaveBeenCalled()
  })

  it('keeps ?comfyWorker=N targeting on the forward', async () => {
    upstream({ project: {} })
    await call('/sailor/projects/p-mine?comfyWorker=2')
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8191/sailor/projects/p-mine')
  })

  it('forwards the /comfyui alias to the engine\'s real path', async () => {
    upstream({ project: {} })
    await call('/comfyui/sailor/projects/p-mine')
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8188/sailor/projects/p-mine')
  })

  it('never forwards a client-supplied identity header — only origin + content-type', async () => {
    rawBody.mockResolvedValue(Buffer.from('{}'))
    requestHeader.mockImplementation((_e: any, n: string) => (n === 'content-type' ? 'application/json' : 'spoofed'))
    upstream({ project: {} })
    await call('/sailor/projects/p-mine', 'PUT')
    expect(Object.keys(fetchMock.mock.calls[0][1].headers).sort()).toEqual(['content-type', 'origin'])
  })
})

// ------------------------------------------------------- middleware wiring

describe('hosted middleware: every alias reaches the gate, none reach the raw proxy', () => {
  it('gates the canonical and /comfyui-aliased projects routes', async () => {
    for (const p of ['/sailor/projects/p-theirs', '/comfyui/sailor/projects/p-theirs', '/sailor/assets/../projects/p-theirs']) {
      proxyRequest.mockClear(); fetchMock.mockClear(); upstream({ project: {} })
      const r = await via(p, 'GET')
      expect(r.status, p).toBe(404)
      expect(proxyRequest, p).not.toHaveBeenCalled()
      expect(fetchMock, p).not.toHaveBeenCalled()
    }
  })

  it('refuses the /api mirror of the projects routes outright', async () => {
    // ComfyUI mirrors EVERY route under /api (server.py:1207-1218), including
    // this extension's. `/sailor` is not in ENGINE_ROUTE_PREFIXES, so the alias
    // never normalizes — and the deny-by-default tail refuses it. Either way it
    // must never raw-proxy or reach the engine.
    for (const p of ['/api/sailor/projects', '/api/sailor/projects/p-theirs', '/comfyui/api/sailor/projects/p-theirs']) {
      proxyRequest.mockClear()
      const r = await via(p, 'GET')
      expect(r.status, p).toBe(403)
      expect(proxyRequest, p).not.toHaveBeenCalled()
    }
  })

  it('403s the install-wide spend summary and its aliases', async () => {
    for (const p of ['/sailor/spend/summary', '/comfyui/sailor/spend/summary', '/sailor/spend']) {
      proxyRequest.mockClear()
      expect((await via(p, 'GET')).status, p).toBe(403)
      expect(proxyRequest, p).not.toHaveBeenCalled()
    }
  })

  it('serves the caller\'s own list end to end through the middleware', async () => {
    upstream({ projects: [{ uuid: 'p-mine' }, { uuid: 'p-theirs' }] })
    const r = await via('/sailor/projects')
    expect(r.body.projects.map((p: any) => p.uuid)).toEqual(['p-mine'])
    expect(proxyRequest).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------- local mode

describe('LOCAL MODE IS BYTE-IDENTICAL — no registry, no filter, no 404', () => {
  const ALL = [
    ['/sailor/projects', 'GET', 'http://127.0.0.1:8188/sailor/projects'],
    ['/sailor/projects/p-theirs', 'GET', 'http://127.0.0.1:8188/sailor/projects/p-theirs'],
    ['/sailor/projects/p-theirs', 'PUT', 'http://127.0.0.1:8188/sailor/projects/p-theirs'],
    ['/sailor/projects/p-theirs', 'DELETE', 'http://127.0.0.1:8188/sailor/projects/p-theirs'],
    ['/sailor/projects/p-orphan/versions', 'POST', 'http://127.0.0.1:8188/sailor/projects/p-orphan/versions'],
    ['/sailor/projects/p-orphan/generations', 'GET', 'http://127.0.0.1:8188/sailor/projects/p-orphan/generations'],
    ['/sailor/spend/summary', 'GET', 'http://127.0.0.1:8188/sailor/spend/summary'],
    ['/comfyui/sailor/projects', 'GET', 'http://127.0.0.1:8188/sailor/projects'],
    ['/sailor/projects?comfyWorker=2', 'GET', 'http://127.0.0.1:8191/sailor/projects'],
    ['/sailor/assets', 'GET', 'http://127.0.0.1:8188/sailor/assets'],
  ] as const

  it('raw-proxies every /sailor path to the pre-Stage-6 target', async () => {
    mode = 'local'
    for (const [p, m, target] of ALL) {
      proxyRequest.mockClear()
      const r = await via(p, m, null)
      expect(r.status, `${m} ${p}`).toBe('proxied')
      expect(r.target, `${m} ${p}`).toBe(target)
    }
  })

  it('never consults the ownership registry or the gate\'s own fetch locally', async () => {
    mode = 'local'
    for (const [p, m] of ALL) await via(p, m, null)
    expect(queries, 'local mode must never query resource_owners').toEqual([])
    expect(fetchMock, 'local mode must never take the gate\'s forward path').not.toHaveBeenCalled()
  })
})

// ------------------------------------------------- non-projects /sailor routes

describe('the rest of the /sailor extension keeps today\'s behaviour', () => {
  it('still raw-proxies the un-audited engine extension routes in hosted mode', async () => {
    // Task 2 audited exactly two families: projects (gated) and spend
    // (refused). The other ~25 /sailor routes (assets, listings, shader
    // effects, timeline render) are a separate audit — refusing them here
    // would break the hosted canvas without closing this P0. Documented as a
    // known gap rather than silently left inside HOSTED_RAW_ALLOW.
    for (const p of ['/sailor/assets', '/sailor/shader_effects', '/sailor/output_listing']) {
      proxyRequest.mockClear()
      expect((await via(p, 'GET')).status, p).toBe('proxied')
    }
  })
})
