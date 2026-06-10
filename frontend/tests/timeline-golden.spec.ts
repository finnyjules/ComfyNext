import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import { PNG } from 'pngjs'

// Golden-frame parity: render fixture frames through the harness page's
// PreviewRenderer and diff against the committed Python goldens
// (tests-unit/timeline_golden). Phase 0 runs the ServerFrameRenderer (ground
// truth — validates the pipeline); Phase 1 points the same spec at the WebGL
// engine and this becomes the real parity gate.
//
// Requires both dev servers (see playwright.config.ts header) and a Python
// server new enough to have /comfynext/timeline/render_frame.

// ESM-safe: package.json has "type":"module" so __dirname is not available;
// use import.meta.url + fileURLToPath instead (mirrors tests/unit/fixtures.unit.spec.ts).
const thisDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(thisDir, '../..')
const fixturesDir = path.join(repoRoot, 'tests-unit', 'timeline_fixtures')
const goldenDir = path.join(repoRoot, 'tests-unit', 'timeline_golden')

const TOL_MAX = 2 / 255
const TOL_MEAN = 0.5 / 255

function decodeDataUrl(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.split(',')[1]!, 'base64'))
}

function diffStats(a: PNG, b: PNG): { max: number; mean: number } {
  if (a.width !== b.width || a.height !== b.height) return { max: 1, mean: 1 }
  let max = 0
  let sum = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c]! - b.data[i + c]!) / 255
      if (d > max) max = d
      sum += d
      n++
    }
  }
  return { max, mean: sum / n }
}

const fixtures = readdirSync(fixturesDir).filter(f => f.endsWith('.json'))

for (const fixtureFile of fixtures) {
  test(`golden parity via harness: ${fixtureFile}`, async ({ page }) => {
    const raw = JSON.parse(readFileSync(path.join(fixturesDir, fixtureFile), 'utf-8'))
    const frames: number[] = raw._golden.frames
    // The Python endpoint runs on this machine — absolutize fixture paths.
    for (const track of raw.tracks) {
      for (const clip of track.clips) {
        if (clip.path && !path.isAbsolute(clip.path)) {
          clip.path = path.join(fixturesDir, clip.path)
        }
      }
    }

    await page.goto('/timeline-harness')
    await page.getByTestId('harness-status').waitFor()
    // onMounted sets window.__timelineHarness — wait for hydration to complete.
    await page.waitForFunction(() => !!(window as any).__timelineHarness, { timeout: 10_000 })
    await page.evaluate(
      (stateJson) => (window as any).__timelineHarness.load(stateJson),
      JSON.stringify(raw),
    )

    const stem = fixtureFile.replace(/\.json$/, '')
    for (const frame of frames) {
      const goldenPath = path.join(goldenDir, stem, `f${String(frame).padStart(3, '0')}.png`)
      expect(existsSync(goldenPath), `missing golden ${goldenPath}`).toBe(true)

      const dataUrl: string = await page.evaluate(
        (f) => (window as any).__timelineHarness.renderFrame(f),
        frame,
      )
      const rendered = decodeDataUrl(dataUrl)
      const golden = PNG.sync.read(readFileSync(goldenPath))
      const { max, mean } = diffStats(rendered, golden)
      expect(max, `${stem} f${frame} max diff`).toBeLessThanOrEqual(TOL_MAX)
      expect(mean, `${stem} f${frame} mean diff`).toBeLessThanOrEqual(TOL_MEAN)
    }
  })
}
