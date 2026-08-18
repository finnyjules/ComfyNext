/**
 * Stage 6 Task 7 — a submitted graph may only reference files the CALLER owns.
 *
 * The threat: a hand-edited graph carrying `LoadImage.image = "victim.png"` (or
 * `LoadImageOutput.image = <another tenant's output>`, or an `[output]`-
 * annotated value on any upload-flagged input) reads a file the caller never
 * uploaded/produced. `validateGraphFileRefs` refuses (403) BEFORE any credit is
 * held, so a refusal costs nothing. Fail closed: an upload-flagged input whose
 * value is not a plain filename string (a number, an object, a wired link) is
 * refused too — we cannot vet what we cannot read.
 *
 * `shortUserHash` + `injectOutputSubfolder` cover the write side: outputs land
 * in `output/u_<hash>/...` and a client-supplied prefix can never escape the
 * caller's own subfolder.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  validateGraphFileRefs,
  shortUserHash,
  injectOutputSubfolder,
  loadUploadFlaggedInputs,
  __resetUploadFlagMapForTests,
} from '../../server/utils/meterGraphRun'
import { MeterRefusalError } from '../../server/utils/requestMeter'

/** A ctx whose ownership answers are fully controlled by the test. */
function ctx(overrides: Partial<any> = {}) {
  return {
    uploadFlagged: new Set<string>(['LoadImage.image', 'LoadImageOutput.image']),
    ownsInput: vi.fn(async (_name: string) => true),
    ownsOutput: vi.fn(async (_annotated: string) => true),
    ...overrides,
  }
}

const loadImage = (image: unknown) => ({ '1': { class_type: 'LoadImage', inputs: { image } } })
const loadOutput = (image: unknown) => ({ '1': { class_type: 'LoadImageOutput', inputs: { image } } })

describe('validateGraphFileRefs — input ownership', () => {
  it('passes a graph that references only the caller-owned input file', async () => {
    const c = ctx({ ownsInput: vi.fn(async () => true) })
    await expect(validateGraphFileRefs(loadImage('mine.png'), c)).resolves.toBeUndefined()
    expect(c.ownsInput).toHaveBeenCalledWith('mine.png')
    expect(c.ownsOutput).not.toHaveBeenCalled()
  })

  it('REFUSES (403) a graph referencing another user\'s input file', async () => {
    const c = ctx({ ownsInput: vi.fn(async () => false) })
    await expect(validateGraphFileRefs(loadImage('victim.png'), c)).rejects.toBeInstanceOf(MeterRefusalError)
    await expect(validateGraphFileRefs(loadImage('victim.png'), c)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('routes an [output]-annotated value on a LoadImage input to the OUTPUT check', async () => {
    const c = ctx({ ownsOutput: vi.fn(async () => false), ownsInput: vi.fn(async () => true) })
    await expect(validateGraphFileRefs(loadImage('victim.png [output]'), c)).rejects.toMatchObject({ statusCode: 403 })
    expect(c.ownsOutput).toHaveBeenCalledWith('victim.png [output]')
    expect(c.ownsInput).not.toHaveBeenCalled()
  })

  it('routes an [input]/[temp]/unannotated value to the INPUT check', async () => {
    const c = ctx({ ownsInput: vi.fn(async () => true) })
    await validateGraphFileRefs(loadImage('a.png [input]'), c)
    await validateGraphFileRefs(loadImage('b.png [temp]'), c)
    await validateGraphFileRefs(loadImage('c.png'), c)
    expect(c.ownsInput.mock.calls.map(x => x[0])).toEqual(['a.png', 'b.png', 'c.png'])
    expect(c.ownsOutput).not.toHaveBeenCalled()
  })
})

describe('validateGraphFileRefs — LoadImageOutput is always an OUTPUT read', () => {
  it('checks a LoadImageOutput.image value against OUTPUTS even with no annotation', async () => {
    const c = ctx({ ownsOutput: vi.fn(async () => true), ownsInput: vi.fn(async () => false) })
    await validateGraphFileRefs(loadOutput('u_abc/mine.png'), c)
    expect(c.ownsOutput).toHaveBeenCalledWith('u_abc/mine.png')
    expect(c.ownsInput).not.toHaveBeenCalled()
  })

  it('REFUSES (403) a LoadImageOutput referencing another user\'s output', async () => {
    const c = ctx({ ownsOutput: vi.fn(async () => false) })
    await expect(validateGraphFileRefs(loadOutput('u_other/theirs.png'), c)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('checks LoadImageOutput even when it is NOT in the uploadFlagged set (hardcoded pair)', async () => {
    const c = ctx({ uploadFlagged: new Set<string>(), ownsOutput: vi.fn(async () => false) })
    await expect(validateGraphFileRefs(loadOutput('theirs.png'), c)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('validateGraphFileRefs — fail closed on unknown shapes', () => {
  it('REFUSES a flagged input carrying a non-string value (wired link / object / number)', async () => {
    for (const bad of [['9', 0], 42, { a: 1 }, true]) {
      await expect(validateGraphFileRefs(loadImage(bad), ctx())).rejects.toMatchObject({ statusCode: 403 })
    }
  })

  it('skips an absent or empty flagged input (no file referenced)', async () => {
    const c = ctx()
    await validateGraphFileRefs({ '1': { class_type: 'LoadImage', inputs: {} } }, c)
    await validateGraphFileRefs(loadImage(''), c)
    await validateGraphFileRefs(loadImage(null), c)
    expect(c.ownsInput).not.toHaveBeenCalled()
    expect(c.ownsOutput).not.toHaveBeenCalled()
  })

  it('leaves a zero-file graph (no flagged inputs) completely untouched', async () => {
    const c = ctx()
    await validateGraphFileRefs({ '1': { class_type: 'SaveImage', inputs: { images: ['2', 0] } } }, c)
    expect(c.ownsInput).not.toHaveBeenCalled()
    expect(c.ownsOutput).not.toHaveBeenCalled()
  })

  it('ignores a non-flagged string input on an otherwise-flagged node class', async () => {
    // KSampler.seed is a string here but is not upload-flagged — must not be
    // treated as a file reference.
    const c = ctx({ uploadFlagged: new Set(['LoadImage.image']) })
    await validateGraphFileRefs({ '1': { class_type: 'KSampler', inputs: { seed: 'abc.png' } } }, c)
    expect(c.ownsInput).not.toHaveBeenCalled()
  })
})

describe('loadUploadFlaggedInputs — derived from the live object_info catalog', () => {
  const catalog = {
    // legacy shape: [ ["file", ...], { image_upload: true } ]
    LoadImage: { input: { required: { image: [['a.png', 'b.png'], { image_upload: true }] } } },
    // v2 shape: [ "COMBO", { options:[...], audio_upload: true } ]
    LoadAudio: { input: { required: { audio: ['COMBO', { options: [], audio_upload: true }] } } },
    // no upload flag → not collected (shared model asset)
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['x.safetensors'], {}] } } },
  }

  it('collects every upload-flagged (ClassType.inputName) pair PLUS the hardcoded LoadImageOutput.image', async () => {
    __resetUploadFlagMapForTests()
    const fetchCatalog = vi.fn(async () => catalog)
    const set = await loadUploadFlaggedInputs(fetchCatalog)
    expect(set.has('LoadImage.image')).toBe(true)
    expect(set.has('LoadAudio.audio')).toBe(true)
    expect(set.has('CheckpointLoaderSimple.ckpt_name')).toBe(false)
    // remote-routed, never object_info-flagged (nodes.py:1951-1959) — added by hand
    expect(set.has('LoadImageOutput.image')).toBe(true)
  })

  it('caches per process (does not refetch the catalog within the TTL)', async () => {
    __resetUploadFlagMapForTests()
    const fetchCatalog = vi.fn(async () => catalog)
    await loadUploadFlaggedInputs(fetchCatalog)
    await loadUploadFlaggedInputs(fetchCatalog)
    expect(fetchCatalog).toHaveBeenCalledTimes(1)
  })
})

describe('shortUserHash', () => {
  it('is a deterministic 12-hex-char sha256 prefix with no PII', () => {
    const h = shortUserHash('user_2abc')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
    expect(h).toBe(shortUserHash('user_2abc'))
    expect(h).not.toContain('user')
    expect(shortUserHash('user_2abc')).not.toBe(shortUserHash('user_2abd'))
  })
})

describe('injectOutputSubfolder', () => {
  const hash = shortUserHash('u1')

  it('prefixes SaveImage output with the caller subfolder, defaulting to ComfyUI', () => {
    const out = injectOutputSubfolder({ '1': { class_type: 'SaveImage', inputs: {} } }, 'u1')
    expect(out['1'].inputs.filename_prefix).toBe(`u_${hash}/ComfyUI`)
  })

  it('preserves a custom prefix as the suffix', () => {
    const out = injectOutputSubfolder({ '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'MyRender' } } }, 'u1')
    expect(out['1'].inputs.filename_prefix).toBe(`u_${hash}/MyRender`)
  })

  it('REPLACES a client-supplied foreign per-user prefix (caller hash appears exactly once)', () => {
    const out = injectOutputSubfolder({ '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'u_deadbeefcafe/evil' } } }, 'u1')
    const p = out['1'].inputs.filename_prefix as string
    expect(p).toBe(`u_${hash}/evil`)
    expect(p.match(/u_/g)?.length).toBe(1)
  })

  it('strips ../ traversal from a client prefix before prefixing', () => {
    const out = injectOutputSubfolder({ '1': { class_type: 'SaveImage', inputs: { filename_prefix: '../../etc/x' } } }, 'u1')
    expect(out['1'].inputs.filename_prefix).toBe(`u_${hash}/etc/x`)
  })

  it('injects into the whole SaveImage family, and does not mutate the input object', () => {
    const src = {
      '1': { class_type: 'SaveVideo', inputs: {} },
      '2': { class_type: 'SaveAudio', inputs: { filename_prefix: 'song' } },
      '3': { class_type: 'KSampler', inputs: { seed: 5 } },
    }
    const out = injectOutputSubfolder(src, 'u1')
    expect(out['1'].inputs.filename_prefix).toBe(`u_${hash}/ComfyUI`)
    expect(out['2'].inputs.filename_prefix).toBe(`u_${hash}/song`)
    expect(out['3'].inputs).toEqual({ seed: 5 })
    // original untouched (clone semantics — no cross-request bleed)
    expect((src['1'].inputs as any).filename_prefix).toBeUndefined()
  })
})
