/**
 * Stage 5 round-3 security review — R1 + R2 + R4: ownership-scoped overwrite on
 * the hosted /upload sink.
 *
 * ROUND 2 shipped a byte-sniff: any multipart body whose bytes matched
 * /name=(?:"overwrite"|overwrite)/ was refused with a 403. Round 3 found both
 * halves of that wrong.
 *
 * R1 — the sniff is bypassable. aiohttp (the engine's parser) accepts spellings
 * the regex never matched. Measured on THIS repo's aiohttp against the exact
 * bytes below (post.get("overwrite") == "true" in every OK row):
 *
 *     Content-Disposition parameter        aiohttp        undici (ours)
 *     name="overwrite"                     overwrite      overwrite
 *     name ="overwrite"                    overwrite      body REJECTED
 *     name= "overwrite"                    overwrite      body REJECTED
 *     name = "overwrite"                   overwrite      body REJECTED
 *     name*=utf-8''overwrite               overwrite      body REJECTED
 *     name=overwrite                       overwrite      body REJECTED
 *     NAME="overwrite"                     overwrite      body REJECTED
 *     name="over\write"                    overwrite      over\write  (!)
 *
 * So the gate parses instead of scanning, with the project's own parser
 * (server/utils/multipart.ts → undici). Everything undici refuses is a body the
 * two parsers cannot agree about, and is refused with a 400 rather than
 * forwarded — the smuggles never reach the engine either way. The one row where
 * undici succeeds and aiohttp still reads `overwrite` is the backslash escape,
 * so a backslash in ANY part name is refused too: it is the whole remaining
 * divergence surface, and it reaches `subfolder` and `type` as readily as
 * `overwrite` — a body checked against one path and written to another.
 *
 * R2 — refusing the field outright breaks Sailor. Eight app call sites append
 * overwrite=true (Compositor, Inpaint, LoRA trainer, Scene3D, layout agent,
 * canvas drops), nearly all on freshly-minted unique filenames. So the decision
 * is ownership-scoped, not a blanket refusal: your own file, or a name nobody
 * has claimed and nothing on disk answers to.
 *
 * R4 — the body is buffered to be parsed, so it needs an explicit cap.
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

// The on-disk half of the "is this name free?" question. Mocked so the suite
// never depends on what happens to be sitting in the dev engine's input dir.
const existsOnDisk = vi.fn((_p: string) => false)
vi.mock('node:fs', async (orig) => {
  const actual = await orig() as any
  return { ...actual, existsSync: (p: any) => existsOnDisk(String(p)) }
})

let mode: 'local' | 'hosted' = 'local'
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

const { handleHostedUpload, normalizeFieldName, decideOverwrite, MAX_UPLOAD_BYTES }
  = await import('../../server/utils/engineGate')
const { __setInputUploadsDbForTests, __setInputUploadsEngineRootForTests, canonicalUploadKey }
  = await import('../../server/utils/inputUploads')
const middleware = (await import('../../server/middleware/comfyui-proxy')).default as any

// ---------------------------------------------------------------- fake tables

const owners = new Map<string, string>()
const queries: string[] = []
__setInputUploadsDbForTests({
  async query(sql: string, params: unknown[] = []) {
    queries.push(sql)
    if (/insert\s+into\s+input_uploads/i.test(sql)) {
      const [key, user] = params as string[]
      // ON CONFLICT DO NOTHING — the first owner keeps the name.
      if (!owners.has(key)) owners.set(key, user)
      return { rows: [] }
    }
    if (/select\s+user_id\s+from\s+input_uploads/i.test(sql)) {
      const [key] = params as string[]
      const u = owners.get(key)
      return { rows: u ? [{ user_id: u }] : [] }
    }
    throw new Error(`unexpected sql: ${sql}`)
  },
})

const fetchMock = vi.fn()
;(globalThis as any).fetch = fetchMock

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ status: 200, text: async () => '{"name":"a.png","subfolder":"","type":"input"}' })
  rawBody.mockReset()
  requestHeader.mockReset()
  requestHeader.mockReturnValue(`multipart/form-data; boundary=${BOUNDARY}`)
  existsOnDisk.mockReset()
  existsOnDisk.mockReturnValue(false)
  owners.clear()
  queries.length = 0
  lastStatus = 0
  // S2: root resolution also goes through the (mocked) node:fs existsSync,
  // so without an override every test's engine-root marker check would ride
  // the SAME existsOnDisk mock as the on-disk file check above — a test that
  // sets existsOnDisk to false to mean "nothing on disk" would incidentally
  // also make the root unresolvable. Pin a fake resolved root by default so
  // these tests keep exercising the on-disk-existence decision they're
  // named for; the dedicated S2 tests below override this back to null.
  __setInputUploadsEngineRootForTests('/fake/engine/root')
})

// ------------------------------------------------------------------- fixtures

const BOUNDARY = '----WebKitFormBoundaryABC'

type Part = { disposition: string, value: string }

function raw(parts: Part[]): Buffer {
  const chunks = parts.map(p =>
    `--${BOUNDARY}\r\nContent-Disposition: form-data; ${p.disposition}\r\n\r\n${p.value}\r\n`)
  return Buffer.from(chunks.join('') + `--${BOUNDARY}--\r\n`, 'latin1')
}

/** A browser-shaped upload: one file part plus whatever fields are asked for. */
function upload(o: { filename?: string, fields?: Record<string, string> } = {}): Buffer {
  const parts: Part[] = [{
    disposition: `name="image"; filename="${o.filename ?? 'a.png'}"`,
    value: 'PIXELS',
  }]
  for (const [k, v] of Object.entries(o.fields ?? {})) parts.push({ disposition: `name="${k}"`, value: v })
  return raw(parts)
}

const ev = (path = '/upload/image', userId: string | null = 'u1') => ({ path, context: { userId } }) as any

// --------------------------------------------------------------------- R1

describe('R1 — the overwrite field is found by a parser, not by a byte scan', () => {
  // Every spelling aiohttp resolves to `overwrite` but the round-2 regex missed.
  const SMUGGLES: [string, string][] = [
    ['space before =', `name ="overwrite"`],
    ['space after =', `name= "overwrite"`],
    ['spaces both sides', `name = "overwrite"`],
    ['RFC 2231 extended', `name*=utf-8''overwrite`],
  ]

  for (const [label, disposition] of SMUGGLES) {
    it(`refuses the ${label} smuggle instead of forwarding it — victim owns the name`, async () => {
      owners.set('input::victim.png', 'u2')
      rawBody.mockResolvedValue(raw([
        { disposition: `name="image"; filename="victim.png"`, value: 'PIXELS' },
        { disposition, value: 'true' },
      ]))
      await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 400 })
      expect(fetchMock, 'the smuggle must never reach the engine').not.toHaveBeenCalled()
    })

    it(`refuses the ${label} smuggle for the OWNER too — the two parsers disagree about these bytes`, async () => {
      owners.set('input::mine.png', 'u1')
      rawBody.mockResolvedValue(raw([
        { disposition: `name="image"; filename="mine.png"`, value: 'PIXELS' },
        { disposition, value: 'true' },
      ]))
      await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 400 })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('refuses the backslash-escape divergence, which undici DOES parse', async () => {
    // undici reads this field name as `over\write`; aiohttp un-escapes it to
    // `overwrite` and honours it — the one smuggle that survives a strict parse.
    owners.set('input::victim.png', 'u2')
    rawBody.mockResolvedValue(raw([
      { disposition: `name="image"; filename="victim.png"`, value: 'PIXELS' },
      { disposition: `name="over\\write"`, value: 'true' },
    ]))
    await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a backslash in ANY field name, not just overwrite', async () => {
    // `sub\folder` is `subfolder` to the engine and an unknown field to us, so
    // the path we check and the path it writes would be different files.
    owners.set('input:clips:victim.png', 'u2')
    rawBody.mockResolvedValue(raw([
      { disposition: `name="image"; filename="victim.png"`, value: 'PIXELS' },
      { disposition: `name="sub\\folder"`, value: 'clips' },
      { disposition: `name="overwrite"`, value: 'true' },
    ]))
    await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gates on ANY truthy overwrite part, not on the one a lookup would find', async () => {
    // aiohttp's post.get() returns the FIRST occurrence; a decoy `false` after a
    // real `true` (or before it) must not decide this for us either way.
    owners.set('input::victim.png', 'u2')
    for (const values of [['true', 'false'], ['false', 'true']]) {
      fetchMock.mockClear()
      rawBody.mockResolvedValue(raw([
        { disposition: `name="image"; filename="victim.png"`, value: 'PIXELS' },
        { disposition: `name="overwrite"`, value: values[0]! },
        { disposition: `name="overwrite"`, value: values[1]! },
      ]))
      await expect(handleHostedUpload(ev()), `values ${values.join(',')}`)
        .rejects.toMatchObject({ statusCode: 403 })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('normalizeFieldName un-escapes, trims and lowercases', () => {
    expect(normalizeFieldName('over\\write')).toBe('overwrite')
    expect(normalizeFieldName(' OverWrite ')).toBe('overwrite')
    expect(normalizeFieldName('overwrite_note')).toBe('overwrite_note')
  })
})

// --------------------------------------------------------------------- R2

describe('R2 — overwrite is scoped to the owner, not refused outright', () => {
  it('ALLOWS the recorded owner to overwrite their own file', async () => {
    owners.set('input::mine.png', 'u1')
    rawBody.mockResolvedValue(upload({ filename: 'mine.png', fields: { overwrite: 'true' } }))
    existsOnDisk.mockReturnValue(true)

    await handleHostedUpload(ev())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8188/upload/image')
  })

  it('REFUSES a cross-tenant overwrite with a 403 that names the conflict', async () => {
    owners.set('input::victim.png', 'u2')
    rawBody.mockResolvedValue(upload({ filename: 'victim.png', fields: { overwrite: 'true' } }))

    await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 403 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ALLOWS overwrite of a fresh name — no owner, nothing on disk — and records it', async () => {
    rawBody.mockResolvedValue(upload({ filename: 'agent_gen_123.png', fields: { overwrite: 'true' } }))
    fetchMock.mockResolvedValue({ status: 200, text: async () => '{"name":"agent_gen_123.png","subfolder":"","type":"input"}' })

    await handleHostedUpload(ev())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(owners.get('input::agent_gen_123.png')).toBe('u1')
  })

  it('REFUSES overwrite of an unclaimed name that ALREADY EXISTS on disk', async () => {
    // Pre-gate uploads carry no ownership row. An existing file with no owner
    // is somebody's — it is not a free name.
    existsOnDisk.mockReturnValue(true)
    rawBody.mockResolvedValue(upload({ filename: 'legacy.png', fields: { overwrite: 'true' } }))

    await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 403 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats only aiohttp-truthy values as an overwrite request', async () => {
    // server.py: `overwrite == "true" or overwrite == "1"`. Anything else and
    // the engine auto-suffixes, so there is nothing to gate.
    owners.set('input::victim.png', 'u2')
    for (const v of ['false', '0', 'yes', '']) {
      fetchMock.mockClear()
      rawBody.mockResolvedValue(upload({ filename: 'victim.png', fields: { overwrite: v } }))
      await handleHostedUpload(ev())
      expect(fetchMock, `overwrite=${JSON.stringify(v)} is not an overwrite`).toHaveBeenCalledTimes(1)
    }
    for (const v of ['true', '1', 'TRUE', ' true ']) {
      fetchMock.mockClear()
      rawBody.mockResolvedValue(upload({ filename: 'victim.png', fields: { overwrite: v } }))
      await expect(handleHostedUpload(ev()), `overwrite=${JSON.stringify(v)} must be gated`)
        .rejects.toMatchObject({ statusCode: 403 })
    }
  })

  it('never gates an upload that declares no overwrite — the engine auto-suffixes', async () => {
    owners.set('input::victim.png', 'u2')
    existsOnDisk.mockReturnValue(true)
    rawBody.mockResolvedValue(upload({ filename: 'victim.png' }))
    await handleHostedUpload(ev())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keys ownership by type + subfolder, not by filename alone', async () => {
    owners.set('input:clips:v.png', 'u2')
    rawBody.mockResolvedValue(upload({ filename: 'v.png', fields: { subfolder: 'clips', overwrite: 'true' } }))
    await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 403 })

    // Same filename, different subfolder: a different file, not the victim's.
    fetchMock.mockClear()
    rawBody.mockResolvedValue(upload({ filename: 'v.png', fields: { subfolder: 'other', overwrite: 'true' } }))
    await handleHostedUpload(ev())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('decideOverwrite is the whole rule', () => {
    expect(decideOverwrite('u1', 'u1', true)).toBe(true)
    expect(decideOverwrite('u1', 'u2', false)).toBe(false)
    expect(decideOverwrite('u1', null, false)).toBe(true)
    expect(decideOverwrite('u1', null, true)).toBe(false)
  })

  // S2: an unresolvable engine root (see engine-root-resolve.unit.spec.ts)
  // means the disk half of the question is UNKNOWABLE, not "false" — treating
  // it as false would open every unclaimed name to anyone while the server is
  // misconfigured. null must fail closed exactly like existsOnDisk === true.
  it('decideOverwrite fails CLOSED when the disk answer is unknown (root unresolved)', () => {
    expect(decideOverwrite('u1', null, null)).toBe(false)
    // Ownership still wins outright — an unresolved root doesn't relitigate
    // a claim the OWNERSHIP table already answered.
    expect(decideOverwrite('u1', 'u1', null)).toBe(true)
    expect(decideOverwrite('u1', 'u2', null)).toBe(false)
  })
})

// ------------------------------------------------------------------- S1

describe('S1 — the ownership check and the record key are canonicalized the SAME way', () => {
  it('canonicalUploadKey folds an unrecognized type to "input", matching engineDirForType', () => {
    expect(canonicalUploadKey('bogus', '', 'v.png')).toBe(canonicalUploadKey('input', '', 'v.png'))
    expect(canonicalUploadKey(undefined, '', 'v.png')).toBe(canonicalUploadKey('input', '', 'v.png'))
    expect(canonicalUploadKey(null, '', 'v.png')).toBe(canonicalUploadKey('input', '', 'v.png'))
    // output/temp are real engine dirs and must NOT fold into input.
    expect(canonicalUploadKey('output', '', 'v.png')).not.toBe(canonicalUploadKey('input', '', 'v.png'))
    expect(canonicalUploadKey('temp', '', 'v.png')).not.toBe(canonicalUploadKey('input', '', 'v.png'))
  })

  it('canonicalUploadKey folds subfolder "." to "" — same physical directory', () => {
    expect(canonicalUploadKey('input', '.', 'v.png')).toBe(canonicalUploadKey('input', '', 'v.png'))
  })

  it('a real subfolder is left alone — not every alias collapses', () => {
    expect(canonicalUploadKey('input', 'clips', 'v.png')).not.toBe(canonicalUploadKey('input', '', 'v.png'))
  })

  // The exploit shape this closes: a victim's file is recorded under the
  // canonical key, and an attacker's overwrite request uses an alias
  // (type=bogus, or subfolder=".") that the OLD code checked ownership on
  // verbatim — producing a check-key that matched no row, while
  // uploadExistsOnDisk's OWN independent normalization happened to still
  // find the file on disk and deny it. That "protected by luck" chain is
  // exactly what this closes: existsOnDisk is forced to false/unknown-false
  // below, so ONLY a correct ownership-key match can produce the deny.
  for (const alias of [
    { label: 'type=bogus', fields: { type: 'bogus', overwrite: 'true' } },
    { label: 'subfolder=.', fields: { type: 'input', subfolder: '.', overwrite: 'true' } },
  ]) {
    it(`denies a victim-owned file via the OWNERSHIP check under the ${alias.label} alias, even when disk says "not there"`, async () => {
      owners.set(canonicalUploadKey('input', '', 'v.png'), 'victim')
      existsOnDisk.mockReturnValue(false) // disk check alone would say "free"
      rawBody.mockResolvedValue(upload({ filename: 'v.png', fields: alias.fields }))

      await expect(handleHostedUpload(ev('/upload/image', 'attacker')))
        .rejects.toMatchObject({ statusCode: 403 })
      expect(fetchMock, 'the clobber must never reach the engine').not.toHaveBeenCalled()
    })
  }

  it('the OWNER themself can still overwrite under an alias — canonicalization is symmetric', async () => {
    owners.set(canonicalUploadKey('input', '', 'mine.png'), 'u1')
    rawBody.mockResolvedValue(upload({ filename: 'mine.png', fields: { type: 'bogus', overwrite: 'true' } }))

    await handleHostedUpload(ev('/upload/image', 'u1'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('the post-response record is canonicalized too, so a later alias check matches it', async () => {
    rawBody.mockResolvedValue(upload({ filename: 'fresh.png', fields: { type: 'bogus', overwrite: 'true' } }))
    fetchMock.mockResolvedValue({ status: 200, text: async () => '{"name":"fresh.png","subfolder":".","type":"input"}' })

    await handleHostedUpload(ev('/upload/image', 'u1'))
    expect(owners.get(canonicalUploadKey('input', '', 'fresh.png'))).toBe('u1')
  })
})

// ------------------------------------------------------------------- S2

describe('S2 — the overwrite path fails CLOSED when the engine root cannot be resolved', () => {
  it('refuses an overwrite with a 403 naming the misconfiguration, not the generic ownership message', async () => {
    __setInputUploadsEngineRootForTests(null)
    rawBody.mockResolvedValue(upload({ filename: 'anything.png', fields: { overwrite: 'true' } }))

    await expect(handleHostedUpload(ev('/upload/image', 'u1')))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/engine|configur/i) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an OWNED file still overwrites fine even with the root unresolved — ownership never needed the disk', async () => {
    __setInputUploadsEngineRootForTests(null)
    owners.set(canonicalUploadKey('input', '', 'mine.png'), 'u1')
    rawBody.mockResolvedValue(upload({ filename: 'mine.png', fields: { overwrite: 'true' } }))

    await handleHostedUpload(ev('/upload/image', 'u1'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ------------------------------------------------------------- recording

describe('ownership is recorded from the ENGINE response', () => {
  it('records the auto-suffixed name the engine actually stored', async () => {
    rawBody.mockResolvedValue(upload({ filename: 'shot.png' }))
    fetchMock.mockResolvedValue({ status: 200, text: async () => '{"name":"shot (1).png","subfolder":"","type":"input"}' })

    await handleHostedUpload(ev())
    expect(owners.get('input::shot (1).png')).toBe('u1')
    expect(owners.has('input::shot.png'), 'the REQUESTED name was never written').toBe(false)
  })

  it('records subfolder and type from the response too', async () => {
    rawBody.mockResolvedValue(upload({ filename: 'm.png', fields: { type: 'temp', subfolder: 'clips' } }))
    fetchMock.mockResolvedValue({ status: 200, text: async () => '{"name":"m.png","subfolder":"clips","type":"temp"}' })
    await handleHostedUpload(ev())
    expect(owners.get('temp:clips:m.png')).toBe('u1')
  })

  it('keeps the FIRST owner on conflict', async () => {
    owners.set('input::a.png', 'u2')
    rawBody.mockResolvedValue(upload({ filename: 'a.png' }))
    await handleHostedUpload(ev('/upload/image', 'u1'))
    expect(owners.get('input::a.png')).toBe('u2')
  })

  it('records nothing when the engine did not accept the upload', async () => {
    rawBody.mockResolvedValue(upload({ filename: 'a.png' }))
    fetchMock.mockResolvedValue({ status: 400, text: async () => 'Bad Request' })
    expect(await handleHostedUpload(ev())).toBe('Bad Request')
    expect(owners.size).toBe(0)
  })
})

// --------------------------------------------------------------------- R4

describe('R4 — the buffered body has an explicit cap', () => {
  it('rejects an over-cap Content-Length with 413 before reading or parsing', async () => {
    requestHeader.mockImplementation((_e: any, n: string) =>
      n === 'content-length' ? String(MAX_UPLOAD_BYTES + 1) : `multipart/form-data; boundary=${BOUNDARY}`)
    await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 413 })
    expect(rawBody, 'must not buffer a body it has already refused').not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an over-cap body that lied about its length', async () => {
    rawBody.mockResolvedValue(Buffer.alloc(MAX_UPLOAD_BYTES + 1))
    await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 413 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caps at 100 MiB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024)
  })
})

// ------------------------------------------------------------- path safety

describe('the ownership key can never be built from a traversing path', () => {
  const BAD = [
    { filename: '../../secret.png' },
    { filename: 'a/../../secret.png' },
    { filename: '/etc/passwd' },
    { filename: 'a\\b.png' },
    { filename: 'x.png', fields: { subfolder: '../..' } },
    { filename: 'x.png', fields: { subfolder: '/abs' } },
    { filename: 'x.png', fields: { subfolder: 'a\\b' } },
  ]
  for (const c of BAD) {
    it(`400s ${JSON.stringify(c)}`, async () => {
      rawBody.mockResolvedValue(upload({ ...c, fields: { ...(c.fields ?? {}), overwrite: 'true' } }))
      await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 400 })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('allows an ordinary nested subfolder', async () => {
    rawBody.mockResolvedValue(upload({ filename: 'a.png', fields: { subfolder: 'clips/2026', overwrite: 'true' } }))
    await handleHostedUpload(ev())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// --------------------------------------------------------- forwarding shape

describe('the parser decides, the bytes fly untouched', () => {
  it('forwards the ORIGINAL buffer and content-type byte for byte', async () => {
    const body = upload({ filename: 'a.png', fields: { overwrite: 'true' } })
    rawBody.mockResolvedValue(body)

    await handleHostedUpload(ev())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8188/upload/image')
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe(`multipart/form-data; boundary=${BOUNDARY}`)
    expect(Buffer.compare(init.body as Buffer, body), 'forwarded bytes must be identical').toBe(0)
  })

  it('reads the request body exactly once', async () => {
    rawBody.mockResolvedValue(upload())
    await handleHostedUpload(ev())
    expect(rawBody).toHaveBeenCalledTimes(1)
  })

  it('preserves ?comfyWorker=N, the /comfyui base and /upload/mask', async () => {
    rawBody.mockResolvedValue(upload())
    await handleHostedUpload(ev('/upload/image?comfyWorker=2'))
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8191/upload/image')

    fetchMock.mockClear()
    rawBody.mockResolvedValue(upload())
    await handleHostedUpload(ev('/comfyui/upload/mask'))
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8188/upload/mask')
  })

  it('returns the engine status and body verbatim', async () => {
    rawBody.mockResolvedValue(upload())
    fetchMock.mockResolvedValue({ status: 201, text: async () => '{"name":"a.png","subfolder":"","type":"input"}' })
    const out = await handleHostedUpload(ev())
    expect(out).toEqual({ name: 'a.png', subfolder: '', type: 'input' })
    expect(lastStatus).toBe(201)
  })

  it('requires a session', async () => {
    await expect(handleHostedUpload(ev('/upload/image', null))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('400s a body that is not multipart at all', async () => {
    rawBody.mockResolvedValue(Buffer.from('{"json":true}'))
    requestHeader.mockImplementation((_e: any, n: string) => n === 'content-type' ? 'application/json' : undefined)
    await expect(handleHostedUpload(ev())).rejects.toMatchObject({ statusCode: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ local

describe('local mode is untouched — no parse, no table, no gate', () => {
  it('raw-proxies POST /upload/image WITH overwrite=true', async () => {
    mode = 'local'
    proxyRequest.mockClear()
    rawBody.mockResolvedValue(upload({ filename: 'victim.png', fields: { overwrite: 'true' } }))
    owners.set('input::victim.png', 'someone-else')

    const out = await middleware({ path: '/upload/image', method: 'POST', context: {} })
    expect(out).toEqual({ proxiedTo: 'http://127.0.0.1:8188/upload/image' })
    expect(rawBody, 'the local path never buffers the body').not.toHaveBeenCalled()
    expect(queries, 'the local path never touches the ownership table').toEqual([])
    mode = 'hosted'
  })
})
