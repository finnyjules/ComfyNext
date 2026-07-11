import { test, expect } from '@playwright/test'
import { openBlankWorkflow, openTimelineEditor, timelineEditorOverlay, waitForBackend } from './_helpers'

// Flag-on smoke: with sailor:Engine.WebGLPreview set, the timeline editor
// boots the WebGL engine (canvas tagged data-engine="webgl"), renders without
// fallback warnings, and draws real pixels when a clip is added.
// The default-flag path is covered by timeline.spec.ts (Canvas2D, unchanged).

test.describe('Timeline editor — WebGL engine flag', () => {
  test('boots the GL engine and renders a clip', async ({ page }) => {
    const problems: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      if (msg.type() === 'warning' && text.includes('Canvas2D fallback')) problems.push(text)
      if (msg.type() === 'error' && (text.includes('usePlaybackEngineGL') || text.includes('WebGLPreviewRenderer'))) problems.push(text)
    })
    await page.addInitScript(() => {
      try { localStorage.setItem('sailor:Engine.WebGLPreview', 'true') } catch {}
    })

    await waitForBackend(page)
    await openBlankWorkflow(page)
    await openTimelineEditor(page)
    const editor = timelineEditorOverlay(page)

    // The GL composable tags the preview canvas on start (dataset.engine).
    const canvas = editor.locator('canvas[data-engine="webgl"]')
    await expect(canvas).toBeVisible({ timeout: 10_000 })

    // Add a clip the same way the Canvas2D suite does: wait for the async
    // asset list, click the first video file row (skip if input/ has none).
    await expect(editor.locator('[data-testid="asset-row"]').first()).toBeVisible({ timeout: 15_000 })
    const fileRow = editor.locator('[data-testid="asset-row"]', { hasText: /\.(mp4|mov|webm|mxf)/i }).first()
    if ((await fileRow.count()) === 0) {
      test.skip(true, 'no video files in input/ to test against')
    }
    await fileRow.click()
    const clip = editor.locator('.strip-bg .cursor-grab').first()
    await expect(clip).toBeVisible({ timeout: 5_000 })

    // The preview canvas must show non-background pixels once the clip's
    // first frame lands. The displayed canvas is a 2D blit target (the GL
    // renderer drawImage()s its offscreen canvas onto it), so getImageData
    // works. Default canvas bg is #000000 → sum 0 means background. Sample a
    // 3x3 grid rather than one pixel in case the frame center happens to be
    // dark.
    await expect.poll(async () => {
      return canvas.evaluate((c: HTMLCanvasElement) => {
        const ctx = c.getContext('2d')
        if (!ctx || c.width === 0 || c.height === 0) return 0
        let sum = 0
        for (const fx of [0.25, 0.5, 0.75]) {
          for (const fy of [0.25, 0.5, 0.75]) {
            const d = ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data
            sum += d[0]! + d[1]! + d[2]!
          }
        }
        return sum
      })
    }, { timeout: 15_000, message: 'sampled pixels stay background-black' }).toBeGreaterThan(0)

    expect(problems, `engine problems: ${problems.join(' | ')}`).toEqual([])
  })
})
