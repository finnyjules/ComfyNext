import { test, expect } from '@playwright/test'
import { openBlankWorkflow, openTimelineEditor, timelineEditorOverlay, waitForBackend } from './_helpers'

test.describe('Timeline editor', () => {
  test.beforeEach(async ({ page }) => {
    await waitForBackend(page)
    await openBlankWorkflow(page)
    await openTimelineEditor(page)
    // Asset rows are fetched async; wait for at least one to land before tests
    // probe the list. Tests that genuinely need ≥2 use their own gate.
    const editor = timelineEditorOverlay(page)
    await expect(editor.locator('[data-testid="asset-row"]').first()).toBeVisible({ timeout: 15_000 })
  })

  test('shell renders the expected structural elements', async ({ page }) => {
    const editor = timelineEditorOverlay(page)
    await expect(editor.getByText('Timeline Editor')).toBeVisible()
    // Tabs
    await expect(editor.getByRole('button', { name: /AI Ports/ })).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Browse' })).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Library' })).toBeVisible()
    // Zoom controls
    await expect(editor.getByRole('button', { name: 'Fit' })).toBeVisible()
    // Keyboard hint strip
    await expect(editor.locator('kbd', { hasText: 'Space' })).toBeVisible()
    await expect(editor.locator('kbd', { hasText: '⌫' })).toBeVisible()
    // Default tracks
    await expect(editor.getByText('Video 1')).toBeVisible()
    await expect(editor.getByText('Audio 1')).toBeVisible()
  })

  test('ruler shows clean second-based labels', async ({ page }) => {
    const editor = timelineEditorOverlay(page)
    // After mount the ruler should have at least 3 distinct major labels
    // ending in "s". Read all candidate label divs.
    const labels = await editor.locator('div').evaluateAll((els) =>
      els
        .map((e) => (e.textContent ?? '').trim())
        .filter((t) => /^[\d:.]+s$/.test(t)),
    )
    // No duplicates (the old bug was 0s · 0.1s · 0.1s)
    const unique = new Set(labels)
    expect(unique.size).toBeGreaterThanOrEqual(3)
    expect(unique.size).toBe(labels.length)
  })

  test('clicking an input file appends a clip with a filmstrip', async ({ page }) => {
    const editor = timelineEditorOverlay(page)
    // Find first video file in the Browse list.
    const fileRow = editor.locator('[data-testid="asset-row"]', { hasText: /\.(mp4|mov|webm|mxf)/i }).first()
    if ((await fileRow.count()) === 0) {
      test.skip(true, 'no video files in input/ to test against')
    }
    await fileRow.click()
    // Clip block appears on the strip
    const clip = editor.locator('.strip-bg .cursor-grab').first()
    await expect(clip).toBeVisible({ timeout: 5_000 })
    // Filmstrip thumbnails (background-image divs) load within a few seconds.
    await expect.poll(async () => clip.locator('[style*="background-image"]').count(), {
      timeout: 15_000,
    }).toBeGreaterThan(0)
  })

  test('cmd+scroll zooms the timeline', async ({ page }) => {
    const editor = timelineEditorOverlay(page)
    const zoomBtn = editor.locator('button').filter({ hasText: /^\d+(\.\d+)?x$/ }).first()
    const before = await zoomBtn.textContent()
    const strip = editor.locator('.strip-bg').first()
    const box = await strip.boundingBox()
    if (!box) throw new Error('strip not measurable')
    // Hover into the strip then wheel with ctrl/meta.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.down('Meta')
    await page.mouse.wheel(0, -400)
    await page.keyboard.up('Meta')
    await expect.poll(async () => (await zoomBtn.textContent())?.trim(), { timeout: 3_000 }).not.toBe(before?.trim())
  })

  test('shift-click multi-selects two clips', async ({ page }) => {
    const editor = timelineEditorOverlay(page)
    const rows = editor.locator('[data-testid="asset-row"]', { hasText: /\.(mp4|mov|webm|mxf)/i })
    if ((await rows.count()) < 2) test.skip(true, 'need at least 2 input files')
    const clips = editor.locator('.strip-bg .cursor-grab')
    // Click row 1, wait for it to land on the strip, then click row 2.
    // (importAsset is async; clicking too fast can drop the second add.)
    await rows.nth(0).click()
    await expect(clips).toHaveCount(1, { timeout: 10_000 })
    await rows.nth(1).click()
    await expect(clips).toHaveCount(2, { timeout: 10_000 })
    // Now select.
    await clips.nth(0).click()
    await clips.nth(1).click({ modifiers: ['Shift'] })
    const ringed = editor.locator('.strip-bg .cursor-grab.ring-2')
    await expect(ringed).toHaveCount(2)
  })

  test('drag-and-drop: dropping an asset onto a specific frame creates a clip there', async ({ page }) => {
    // Playwright's locator.dragTo() doesn't reliably carry a custom MIME type
    // through synthetic DataTransfer. Instead we dispatch the real DnD event
    // chain ourselves with a populated DataTransfer (which IS allowed via
    // `new DragEvent` in Chromium).
    const editor = timelineEditorOverlay(page)
    // Pick the first asset row and the second-row track lane element.
    const sourceHandle = await editor.locator('[data-testid="asset-row"]').first().elementHandle()
    const trackEl = await editor.locator('.strip-bg').locator('div').filter({ has: page.locator('') }).nth(2).elementHandle().catch(() => null)
    if (!sourceHandle || !trackEl) test.skip(true, 'cannot locate source/target')

    const targetBox = await trackEl!.boundingBox()
    if (!targetBox) throw new Error('target box missing')

    // Run the DnD sequence in the page so DataTransfer is real.
    await page.evaluate(({ tx, ty }) => {
      const src = document.querySelector('[data-testid="asset-row"]') as HTMLElement
      const trackEl = document.querySelectorAll('.strip-bg > div')[2] as HTMLElement
      if (!src || !trackEl) throw new Error('elements not found')
      const dt = new DataTransfer()
      // Mimic the editor's payload directly so the test still proves the drop
      // handler honors cursor position.
      const path = src.title.split(' — ')[0]
      const filename = (src.textContent ?? '').trim()
      dt.setData('application/x-sailor-asset', JSON.stringify({ kind: 'input-file', path, filename }))
      src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }))
      trackEl.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, clientX: tx, clientY: ty, cancelable: true }))
      trackEl.dispatchEvent(new DragEvent('dragover',  { dataTransfer: dt, bubbles: true, clientX: tx, clientY: ty, cancelable: true }))
      trackEl.dispatchEvent(new DragEvent('drop',      { dataTransfer: dt, bubbles: true, clientX: tx, clientY: ty, cancelable: true }))
      src.dispatchEvent(new DragEvent('dragend',  { dataTransfer: dt, bubbles: true }))
    }, { tx: targetBox.x + targetBox.width * 0.5, ty: targetBox.y + 10 })

    // After import, a clip appears and is positioned away from frame 0.
    const clip = editor.locator('.strip-bg .cursor-grab').first()
    await expect(clip).toBeVisible({ timeout: 15_000 })
    const clipBox = await clip.boundingBox()
    expect(clipBox).not.toBeNull()
    expect(clipBox!.x - targetBox.x).toBeGreaterThan(50)
  })

  test('snap guideline appears when a clip drag aligns with the playhead', async ({ page }) => {
    const editor = timelineEditorOverlay(page)
    const row = editor.locator('[data-testid="asset-row"]', { hasText: /\.(mp4|mov|webm|mxf)/i }).first()
    if ((await row.count()) === 0) test.skip(true, 'no files')
    await row.click()
    const clip = editor.locator('.strip-bg .cursor-grab').first()
    await expect(clip).toBeVisible()
    // Drag the clip a couple px back toward frame 0 — snap should trip
    // to the playhead (which sits at 0 by default).
    const box = await clip.boundingBox()
    if (!box) throw new Error('clip not measurable')
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.down()
    // Move slowly to give the snap-guide reactive update time
    for (let dx = 0; dx <= 60; dx += 12) {
      await page.mouse.move(box.x + 20 - dx, box.y + box.height / 2)
      await page.waitForTimeout(40)
    }
    // The fuchsia snap line is an absolute div with `bg-fuchsia-400/80`.
    const snapLine = editor.locator('div.bg-fuchsia-400\\/80')
    await expect(snapLine).toHaveCount(1)
    await page.mouse.up()
  })

  test('audio file renders a waveform inside its clip', async ({ page }) => {
    const editor = timelineEditorOverlay(page)
    const mp3Row = editor.locator('[data-testid="asset-row"]', { hasText: /\.(mp3|wav|flac|m4a|ogg)$/i }).first()
    if ((await mp3Row.count()) === 0) test.skip(true, 'no audio in input/')
    await mp3Row.click()
    // Auto-routes to the Audio track.
    const clip = editor.locator('.strip-bg .cursor-grab').first()
    await expect(clip).toBeVisible()
    await expect.poll(async () => clip.locator('svg path').count(), { timeout: 20_000 }).toBeGreaterThan(0)
  })

  test('Backspace deletes the selected clip and does NOT remove the Timeline node', async ({ page }) => {
    const editor = timelineEditorOverlay(page)
    const row = editor.locator('[data-testid="asset-row"]', { hasText: /\.(mp4|mov|webm|mxf)/i }).first()
    if ((await row.count()) === 0) test.skip(true)
    await row.click()
    const clip = editor.locator('.strip-bg .cursor-grab').first()
    await expect(clip).toBeVisible()
    await clip.click()
    await page.keyboard.press('Backspace')
    await expect(editor.locator('.strip-bg .cursor-grab')).toHaveCount(0)
    // Editor itself remains open (regression: Backspace used to bubble to VueFlow).
    await expect(editor).toBeVisible()
  })

  test('export streaming: progress events arrive and final result has a filename', async ({ page }) => {
    // Talk to the endpoint directly — exercises the SSE/NDJSON path including
    // the bug-fix where the result envelope is `type: "result"` (not `type: "output"`).
    const assets = await page.request.get('/sailor/assets').then((r) => r.json())
    const a = assets.assets?.[0]
    test.skip(!a, 'need at least one imported asset')
    const payload = {
      version: 1,
      canvas: { width: 320, height: 180, fps: 30, bg_color: '#000000' },
      total_frames: 15,
      tracks: [{
        id: 'v1', kind: 'video', name: 'V', muted: false, locked: false,
        clips: [{
          id: 'c1', kind: 'video', asset_id: a.id, path: a.path,
          start_frame: 0, in_frame: 0, length: 15,
          x: 0, y: 0, rotation: 0, scale: 1,
          opacity: 1, blend: 'normal', fade_in: 0, fade_out: 0,
        }],
      }],
    }
    const res = await page.request.post('/sailor/render_timeline_stream', {
      data: payload,
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(200)
    const body = await res.text()
    const events = body.trim().split('\n').map((l) => JSON.parse(l))
    expect(events.some((e) => e.type === 'progress')).toBe(true)
    const result = events.find((e) => e.type === 'result')
    expect(result).toBeTruthy()
    expect(result.result.filename).toMatch(/^timeline_.*\.mp4$/)
  })
})
