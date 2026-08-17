/**
 * Stage 5 security review C2: the annotated-filename escape on /view.
 *
 * ComfyUI's folder_paths.annotated_filepath() resolves a trailing
 * `[output]` / `[input]` / `[temp]` annotation BEFORE the `type` query param
 * is ever consulted (server.py view_image: `filename, output_dir =
 * annotated_filepath(filename)` … `if output_dir is None: type = query.get
 * ("type", "output")`). So Task 5's gate — which only fired on
 * `type === 'output'` — was bypassed by:
 *
 *   GET /view?type=temp&filename=victim.png%20[output]
 *
 * The gate saw type=temp and waved it through; the engine served the
 * protected OUTPUT bytes. `blake3:`-prefixed filenames are a second
 * resolution mode that skips annotation handling entirely and resolves
 * through the engine's asset store.
 *
 * These tests drive the REAL route handler (server/routes/view.get.ts) with
 * a stubbed engine, so they fail against the pre-fix tree.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.createError = (opts: { statusCode: number, message?: string, statusMessage?: string }) => {
  const err = new Error(opts.message ?? opts.statusMessage) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
}
g.getQuery = (event: any) => event.query
g.setResponseHeaders = () => {}

let mode: 'local' | 'hosted' = 'hosted'
vi.mock('../../server/utils/deployMode', () => ({
  deployMode: () => mode,
  isHosted: () => mode === 'hosted',
}))

let owned = new Set<string>()
vi.mock('../../server/utils/graphRuns', async (orig) => {
  const actual = await orig() as any
  return { ...actual, ownedOutputKeys: async () => owned }
})

const harvestPendingOutputs = vi.fn(async () => {})
vi.mock('../../server/utils/engineGate', async (orig) => {
  const actual = await orig() as any
  return { ...actual, harvestPendingOutputs: (...a: any[]) => harvestPendingOutputs(...(a as [])) }
})

// Keep the disk cache out of the test run entirely.
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => Buffer.from('')),
}))
vi.mock('node:fs', () => ({ existsSync: () => false }))

const fetchMock = vi.fn(async (_url: string) => ({
  ok: true,
  headers: { get: () => 'image/png' },
  arrayBuffer: async () => new TextEncoder().encode('PIXELS').buffer,
}))
g.fetch = fetchMock

let handler: (event: any) => Promise<any>
beforeAll(async () => { handler = (await import('../../server/routes/view.get')).default as any })

beforeEach(() => {
  mode = 'hosted'
  owned = new Set()
  fetchMock.mockClear()
  harvestPendingOutputs.mockClear()
})

function ev(query: Record<string, string>) {
  return { query, context: { userId: 'u1' }, node: { req: {}, res: {} } }
}
async function code(query: Record<string, string>): Promise<number | 'served'> {
  try {
    await handler(ev(query))
    return 'served'
  } catch (e: any) { return e?.statusCode ?? 500 }
}

describe('hosted /view — annotation resolves the EFFECTIVE type', () => {
  it('refuses an unowned output smuggled in behind type=temp', async () => {
    expect(await code({ type: 'temp', filename: 'victim.png [output]' })).toBe(404)
    expect(fetchMock, 'engine must never be asked for an unowned output').not.toHaveBeenCalled()
  })

  it('refuses it behind type=input too, and with no type at all', async () => {
    expect(await code({ type: 'input', filename: 'victim.png [output]' })).toBe(404)
    expect(await code({ filename: 'victim.png [output]' })).toBe(404)
  })

  it('gates on the ANNOTATION-STRIPPED basename, so an owned file still serves', async () => {
    owned = new Set(['output::mine.png'])
    expect(await code({ type: 'temp', filename: 'mine.png [output]' })).toBe('served')
    expect(await code({ filename: 'mine.png [output]' })).toBe('served')
    expect(await code({ filename: 'mine.png' })).toBe('served')
  })

  it('carries the subfolder into the ownership key', async () => {
    owned = new Set(['output:sub:mine.png'])
    expect(await code({ type: 'temp', subfolder: 'sub', filename: 'mine.png [output]' })).toBe('served')
    expect(await code({ type: 'temp', subfolder: 'other', filename: 'mine.png [output]' })).toBe(404)
  })

  it('strips path segments the way os.path.basename does', async () => {
    owned = new Set(['output::mine.png'])
    expect(await code({ type: 'temp', filename: 'a/b/mine.png [output]' })).toBe('served')
  })

  it('still gates plain type=output reads (no regression)', async () => {
    expect(await code({ type: 'output', filename: 'victim.png' })).toBe(404)
    expect(harvestPendingOutputs, 'race-window harvest still runs').toHaveBeenCalled()
  })

  it('leaves genuinely-temp reads ungated (documented Stage 5 gap, unchanged)', async () => {
    expect(await code({ type: 'temp', filename: 'scratch.png' })).toBe('served')
  })

  it('rejects blake3: filenames outright — a second resolution mode the key check cannot model', async () => {
    expect(await code({ filename: 'blake3:deadbeef' })).toBe(400)
    expect(await code({ type: 'temp', filename: 'blake3:deadbeef' })).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a session', async () => {
    let threw = 0
    try { await handler({ query: { filename: 'x.png [output]' }, context: {} }) } catch (e: any) { threw = e.statusCode }
    expect(threw).toBe(401)
  })
})

describe('local mode is untouched', () => {
  beforeEach(() => { mode = 'local' })
  it('serves annotated and blake3 filenames exactly as before', async () => {
    expect(await code({ type: 'temp', filename: 'anything.png [output]' })).toBe('served')
    expect(await code({ filename: 'blake3:deadbeef' })).toBe('served')
    expect(await code({ type: 'output', filename: 'whatever.png' })).toBe('served')
    expect(harvestPendingOutputs).not.toHaveBeenCalled()
  })
})
