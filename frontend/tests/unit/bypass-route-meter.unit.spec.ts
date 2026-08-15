/**
 * Task 4 (Stage 4 metering): the "bypass" routes — direct fetches to a
 * provider that don't funnel through the runReplicate/runFal chokepoints
 * (Task 2) or the graph pricer (priceGraph). Six routes in scope:
 * lipsync/speech, voice-clone/start, voice-clone/status, krea/rewrite,
 * lora-cover, replicate-cover. Each was read and classified by hand:
 *  - paid (creates a prediction): gated with preflightMeter + settled on
 *    confirmed success
 *  - free (reads status/metadata only): marked with a METER-EXEMPT comment
 *
 * The coverage guard below is the enforcement mechanism, mirroring
 * price-book.unit.spec.ts's "every model slug in server/ has a price entry"
 * scan — but at the file level: any file making a raw provider-fetch call
 * must show its metering decision (either preflightMeter or METER-EXEMPT:),
 * so a future bypass route can't silently reintroduce unmetered spend.
 *
 * This test is written FIRST per the task's TDD requirement: on the
 * unmodified tree (before Task 4's route edits) it fails for all six
 * in-scope files, because none of them referenced preflightMeter or carried
 * a METER-EXEMPT marker yet. That failure is this test's RED.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MODEL_COSTS } from '../../server/utils/priceBook'

const serverRoot = fileURLToPath(new URL('../../server', import.meta.url))

// The exact fetch targets that mean "this file talks to a paid provider
// directly" — the same three hosts every runReplicate/runFal/priceGraph
// bypass in this codebase has used to date.
const PROVIDER_FETCH_PATTERNS = ['api.replicate.com', 'fal.run', 'queue.fal.run']

/**
 * Task 5 landed training's metering (cloud-train/* + trainingProviders.ts —
 * see their own preflightMeter/settleModel/METER-EXEMPT markers), so the
 * allowlist that used to carve those files out while Task 4 shipped first is
 * gone: this guard now scans every file in server/, no exceptions.
 */
function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (p.endsWith('.ts')) acc.push(p)
  }
  return acc
}

describe('bypass-route meter coverage guard', () => {
  const roots = ['api', 'utils'].map(d => join(serverRoot, d))
  const allFiles = roots.flatMap(r => walk(r))

  it('scan is alive (sanity: server/ has plenty of .ts files)', () => {
    expect(allFiles.length).toBeGreaterThan(10)
  })

  const providerFetchFiles = allFiles.filter((file) => {
    const src = readFileSync(file, 'utf8')
    return PROVIDER_FETCH_PATTERNS.some(p => src.includes(p))
  })

  it('found at least one provider-fetch file per in-scope route group (sanity: matcher is not vacuous)', () => {
    expect(providerFetchFiles.length).toBeGreaterThan(5)
  })

  for (const file of providerFetchFiles) {
    const rel = relative(serverRoot, file)
    it(`${rel} references preflightMeter/settleModel or carries a METER-EXEMPT: marker`, () => {
      const src = readFileSync(file, 'utf8')
      const covered = src.includes('preflightMeter') || src.includes('settleModel') || src.includes('METER-EXEMPT:')
      expect(
        covered,
        `${rel} fetches a provider host (${PROVIDER_FETCH_PATTERNS.join(', ')}) but has ` +
        'neither a preflightMeter/settleModel reference nor a METER-EXEMPT: marker — unmetered spend risk.',
      ).toBe(true)
    })
  }
})

describe('bypass-route price-book rows (Task 4 additions)', () => {
  it('minimax/voice-cloning: $3/voice at 1.5x markup, floor n/a', () => {
    const c = MODEL_COSTS['minimax/voice-cloning']
    expect(c).toBeDefined()
    expect(c!.usd).toBe(3)
    expect(c!.credits).toBe(450) // 3.00 * 100 * 1.5
    expect(c!.confidence).toBe('estimate')
  })

  it('veed/fabric-1.0: flat v1 lip-sync price at 1.5x (>$0.10 band)', () => {
    const c = MODEL_COSTS['veed/fabric-1.0']
    expect(c).toBeDefined()
    expect(c!.usd).toBe(0.75)
    expect(c!.credits).toBe(113) // ceil(0.75 * 100 * 1.5) = ceil(112.5)
    expect(c!.confidence).toBe('estimate')
  })

  it('kwaivgi/kling-lip-sync: flat v1 lip-sync price at 2x (<=$0.10 band)', () => {
    const c = MODEL_COSTS['kwaivgi/kling-lip-sync']
    expect(c).toBeDefined()
    expect(c!.usd).toBe(0.07)
    expect(c!.credits).toBe(14) // 0.07 * 100 * 2 = 14
    expect(c!.confidence).toBe('estimate')
  })

  it('all three new rows clear provider cost and stay within the markup band', () => {
    for (const model of ['minimax/voice-cloning', 'veed/fabric-1.0', 'kwaivgi/kling-lip-sync']) {
      const c = MODEL_COSTS[model]!
      const costInCredits = Math.max(1, Math.ceil(c.usd * 100))
      expect(c.credits, `${model} priced below cost`).toBeGreaterThanOrEqual(costInCredits)
      expect(c.credits, `${model} markup looks like a typo`).toBeLessThanOrEqual(Math.ceil(c.usd * 100 * 3))
    }
  })
})
