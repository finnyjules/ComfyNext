import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// Guards the contract between the Vite library build and the runtime script in
// bundle.ts. Run `npm run build:embed` first — this test asserts its output.
// One vite.embed.config.ts, parameterised by SAILOR_EMBED_SURFACE, builds one
// bundle per embeddable surface — assert the same contract holds for each.
//
// Per-surface size ceiling, not a shared one: gradient.js measures ~66KB
// (vs. shader.js's ~18.6KB) purely because GradientFxRenderer statically
// imports its whole monolithic fragment shader (GRADIENT_FS + BLUR_FS,
// ~700 lines of GLSL in shaders.ts) as JS template literals that esbuild
// cannot minify away. Shader Studio instead resolves each effect's GLSL from
// a config/catalog supplied at runtime, so its bundle never inlines shader
// source at all — that's a structural difference between the two surfaces,
// not gradient accidentally growing a dependency. Confirmed by inspecting
// public/embed/gradient.js directly: no Vue markers, no import statements —
// see the two tests below, which still run against gradient.js and still
// pass. 90,000 keeps that Vue guard meaningful (Vue's minified runtime alone
// is on the order of 100KB) while giving gradient's real, larger footprint
// room to exist. Do not raise it further to hide an actual new dependency —
// re-derive the number from what's really in the bundle, as this comment does.
//
// spacetype.js is a different order of magnitude — ~1.85MB — because it
// statically bundles the entire three.js runtime (WebGLRenderer, the full
// scene graph, geometries, materials) PLUS all 25 Space Type effect modules
// from effects/index.ts (SPACE_TYPE_EFFECTS is one flat array with no lazy
// per-effect split — see spacetype.ts's "throw on unknown effectId" adapter,
// which resolves the effect from that same static array). Neither dependency
// is optional at today's architecture: the adapter cannot know which of the
// 25 effects a given export uses without importing the whole registry, and
// SpaceTypeEngine is built directly on THREE.WebGLRenderer/Scene/Camera. The
// ceiling here is 2,200,000 (~2.1MB) — meaningful headroom over the measured
// ~1.85MB so ordinary edits don't flake the suite, but still tight enough
// that a SECOND copy of three.js, or a network-reaching catalog import (e.g.
// ~/data/google-fonts.ts's `fetch('/api/google-fonts')`, deliberately NOT
// imported by spacetype.ts — see that file's buildTexOpts doc), would blow
// through it. This is not a size budget — three.js + 25 effects at ~1.85MB
// already exceeds the ~1.5MB figure the Task 2 brief flagged as worth
// surfacing on its own; if this ceiling is ever raised, re-derive the number
// from what changed in the bundle rather than padding it to make CI pass, and
// treat a further jump as the signal that per-effect bundle splitting (a real
// architectural change) is now worth doing rather than absorbing quietly.
const SIZE_CEILING_BYTES: Record<string, number> = { shader: 60_000, gradient: 90_000, spacetype: 2_200_000 }

describe.each([
  ['shader', 'shader.js'],
  ['gradient', 'gradient.js'],
  ['spacetype', 'spacetype.js'],
])('prebuilt %s embed bundle', (surface, fileName) => {
  const OUT = path.join(ROOT, 'public', 'embed', fileName)

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
    expect(bytes).toBeLessThan(SIZE_CEILING_BYTES[surface]!)
  })

  it('emits a single self-contained file with no import statements', () => {
    const js = fs.readFileSync(OUT, 'utf8')
    expect(js).not.toMatch(/^\s*import\s/m)
    expect(js).not.toMatch(/\bfrom\s+["'][./]/)
  })
})
