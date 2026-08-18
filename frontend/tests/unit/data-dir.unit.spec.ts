import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { storeDir } from '../../server/utils/dataDir'

const ORIGINAL_ENV = process.env.SAILOR_DATA_DIR

describe('storeDir — SAILOR_DATA_DIR unset (local, byte-identical)', () => {
  beforeEach(() => { delete process.env.SAILOR_DATA_DIR })
  afterEach(() => { if (ORIGINAL_ENV === undefined) delete process.env.SAILOR_DATA_DIR; else process.env.SAILOR_DATA_DIR = ORIGINAL_ENV })

  it('brand-kits matches server/api/brand-kits/index.get.ts', () => {
    expect(storeDir('brand-kits')).toBe(join(process.cwd(), 'server', 'brand-kits'))
  })

  it('moodboards matches server/api/moodboards/*', () => {
    expect(storeDir('moodboards')).toBe(join(process.cwd(), 'server', 'moodboards'))
  })

  it('templates-layouts matches server/api/templates/*', () => {
    expect(storeDir('templates-layouts')).toBe(join(process.cwd(), 'server', 'templates', 'layouts'))
  })

  it('templates-fonts-user matches server/templates/fonts-store.ts', () => {
    expect(storeDir('templates-fonts-user')).toBe(join(process.cwd(), 'server', 'templates', 'fonts', 'user'))
  })

  it('data matches secrets.ts/spendLog.ts frontend/.data', () => {
    expect(storeDir('data')).toBe(join(process.cwd(), '.data'))
  })
})

describe('storeDir — SAILOR_DATA_DIR set', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sailor-data-dir-test-'))
    process.env.SAILOR_DATA_DIR = tmp
  })
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.SAILOR_DATA_DIR; else process.env.SAILOR_DATA_DIR = ORIGINAL_ENV
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns $SAILOR_DATA_DIR/<name> and creates it', () => {
    const dir = storeDir('brand-kits')
    expect(dir).toBe(join(tmp, 'brand-kits'))
    expect(existsSync(dir)).toBe(true)
  })

  it('creates each store name under the env dir', () => {
    for (const name of ['moodboards', 'templates-layouts', 'templates-fonts-user', 'data'] as const) {
      const dir = storeDir(name)
      expect(dir).toBe(join(tmp, name))
      expect(existsSync(dir)).toBe(true)
    }
  })
})
