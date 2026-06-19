import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import * as fs from 'node:fs'

const BASE = process.env.ECHO_BASE_URL ?? 'http://127.0.0.1:3000'
const OUT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '.playground', 'echo')
fs.mkdirSync(OUT, { recursive: true })

// [filename, partialParams, {animate, frame}]
const SHOTS = JSON.parse(process.env.ECHO_SHOTS ?? '[["static",{},{}]]')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 920, height: 680 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))

await page.goto(`${BASE}/dev/spacetype-harness`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__echoReady === true, { timeout: 30000 })

for (const [name, partial, opts] of SHOTS) {
  await page.evaluate(({ partial, opts }) => {
    window.__echo(partial, { animate: !!opts.animate, frame: opts.frame, bg: opts.bg })
  }, { partial, opts })
  // let fonts/texture settle + one rAF
  await page.waitForTimeout(opts.animate ? 600 : 150)
  const canvas = await page.$('canvas')
  await canvas.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log('shot:', name)
}

console.log('errors:', errors.length ? errors : 'none')
await browser.close()
