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

  // The greps above are cheap and catch the unminified case, but minify:
  // 'esbuild' renames local bindings and Rollup inlines modules, so if Vue
  // were ever genuinely pulled in, its package name would not survive as a
  // string literal in the output — the greps would very likely keep passing
  // silently, exactly when they matter most. A coarse size ceiling is robust
  // to renaming: this adapter is ~17.6KB today, and Vue's runtime alone is on
  // the order of 100KB minified, so any accidental inclusion of a dependency
  // that heavy (Vue above all) blows straight past any sane ceiling for what
  // is meant to be a dependency-free adapter. Do not raise this number just
  // to make a failing build pass — figure out what got pulled in instead.
  it('stays well under the size a heavy dependency like Vue would add', () => {
    const bytes = fs.statSync(OUT).size
    expect(bytes).toBeLessThan(60_000)
  })

  it('emits a single self-contained file with no import statements', () => {
    const js = fs.readFileSync(OUT, 'utf8')
    expect(js).not.toMatch(/^\s*import\s/m)
    expect(js).not.toMatch(/\bfrom\s+["'][./]/)
  })
})
