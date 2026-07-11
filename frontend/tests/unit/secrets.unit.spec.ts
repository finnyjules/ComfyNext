import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSecretsFile, writeSecretsFile, maskToken } from '../../server/utils/secrets'

let path: string
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'sailor-secrets-')), 'secrets.json')
})

describe('secrets file store', () => {
  it('returns {} when the file does not exist or is corrupt', () => {
    expect(readSecretsFile(path)).toEqual({})
  })

  it('writes and reads back a token', () => {
    writeSecretsFile({ replicateToken: 'r8_test123' }, path)
    expect(readSecretsFile(path)).toEqual({ replicateToken: 'r8_test123' })
  })

  it('merges patches without dropping other keys', () => {
    writeSecretsFile({ replicateToken: 'r8_first' }, path)
    const next = writeSecretsFile({}, path)
    expect(next.replicateToken).toBe('r8_first')
  })

  it('clears a token when patched with an empty string', () => {
    writeSecretsFile({ replicateToken: 'r8_test123' }, path)
    writeSecretsFile({ replicateToken: '' }, path)
    expect(readSecretsFile(path)).toEqual({})
  })
})

describe('maskToken', () => {
  it('masks all but the last 4 characters', () => {
    expect(maskToken('r8_abcdef1234')).toBe('••••1234')
  })
  it('fully masks short tokens and handles empty', () => {
    expect(maskToken('abc')).toBe('••••')
    expect(maskToken(null)).toBe(null)
    expect(maskToken('')).toBe(null)
  })
})
