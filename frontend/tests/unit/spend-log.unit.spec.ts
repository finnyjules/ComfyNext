// frontend/tests/unit/spend-log.unit.spec.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { logSpend, spendLogPath } from '../../server/utils/spendLog'

const dir = mkdtempSync(join(tmpdir(), 'spend-log-'))
const logFile = join(dir, 'spend.jsonl')

afterEach(() => {
  delete process.env.SAILOR_SPEND_LOG
  rmSync(logFile, { force: true })
})

async function waitForFile(path: string, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (existsSync(path)) return
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error(`file never appeared: ${path}`)
}

describe('spendLog', () => {
  it('appends one JSON line per event with a timestamp', async () => {
    process.env.SAILOR_SPEND_LOG = logFile
    logSpend({ provider: 'replicate', model: 'black-forest-labs/flux-dev', ok: true, ms: 4200 })
    logSpend({ provider: 'fal', model: 'fal-ai/flux-pro/v1/fill', ok: false })
    await waitForFile(logFile)
    // both writes are async appends — poll until both lines land
    let lines: string[] = []
    for (let i = 0; i < 50 && lines.length < 2; i++) {
      lines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean)
      if (lines.length < 2) await new Promise(r => setTimeout(r, 20))
    }
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0])
    expect(first.provider).toBe('replicate')
    expect(first.model).toBe('black-forest-labs/flux-dev')
    expect(first.ok).toBe(true)
    expect(first.ms).toBe(4200)
    expect(new Date(first.ts).getTime()).toBeGreaterThan(0)
    expect(JSON.parse(lines[1]).ok).toBe(false)
  })

  it('respects the SAILOR_SPEND_LOG override', () => {
    process.env.SAILOR_SPEND_LOG = '/tmp/custom.jsonl'
    expect(spendLogPath()).toBe('/tmp/custom.jsonl')
  })

  it('never throws, even when the target directory is unwritable', () => {
    process.env.SAILOR_SPEND_LOG = '/nonexistent-root-dir/deep/spend.jsonl'
    expect(() => logSpend({ provider: 'fal', model: 'x', ok: true })).not.toThrow()
  })
})
