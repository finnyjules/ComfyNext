import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OUT = path.join(ROOT, 'public', 'embed', 'shader.js')

// Guards the contract between the Vite library build and the runtime script in
// bundle.ts. Run `npm run build:embed` first — this test asserts its output.
describe('prebuilt shader embed bundle', () => {
  it('exists — run `npm run build:embed` if this fails', () => {
    expect(fs.existsSync(OUT)).toBe(true)
  })

  it('assigns the global the runtime script reads', () => {
    expect(fs.readFileSync(OUT, 'utf8')).toContain('__SAILOR_SURFACE__')
  })

  it('does not drag Vue into the embed', () => {
    const js = fs.readFileSync(OUT, 'utf8')
    expect(js).not.toContain('createElementVNode')
    expect(js).not.toContain('@vue/runtime-core')
  })

  it('emits a single self-contained file with no import statements', () => {
    const js = fs.readFileSync(OUT, 'utf8')
    expect(js).not.toMatch(/^\s*import\s/m)
    expect(js).not.toMatch(/\bfrom\s+["'][./]/)
  })
})
