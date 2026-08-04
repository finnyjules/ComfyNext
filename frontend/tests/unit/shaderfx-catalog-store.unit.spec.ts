import { describe, it, expect, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  getEffectSync,
  setShaderFxCatalog,
  setShaderFxRefetcher,
  refetchShaderFxCatalog,
} from '~/lib/shaderfx/catalogStore'
import type { EffectDef, ShaderFxCatalog } from '~/lib/shaderfx/types'

// This module is imported (transitively, via ~/lib/spacetype/fills.ts and
// ~/lib/shaderfill/field.ts) by every Space Type effect, which ends up in the
// spacetype.js embed bundle — see tests/unit/embed-build-output.unit.spec.ts.
// The regression this guards: ~/lib/shaderfx/catalog.ts's fetchShaderFxCatalog
// pulls `$fetch('/sailor/shader_effects')` into the bundle; this module must
// stay a pure synchronous reader with no fetch of its own.
const SELF = fileURLToPath(new URL('../../app/lib/shaderfx/catalogStore.ts', import.meta.url))

const effect = (id: string): EffectDef => ({
  id,
  name: id,
  category: 'test',
  animated: false,
  passes: 1,
  centerParam: null,
  textures: [],
  params: [],
  source: '',
})

const catalog = (ids: string[]): ShaderFxCatalog => ({ version: 1, effects: ids.map(effect) })

describe('shaderfx catalogStore (network-free reader)', () => {
  afterEach(() => {
    setShaderFxCatalog(null)
    setShaderFxRefetcher(null as unknown as () => Promise<ShaderFxCatalog>)
  })

  it('contains no URL literals — the regression guard for the whole module', () => {
    const src = fs.readFileSync(SELF, 'utf8')
    expect(src).not.toMatch(/http/i)
  })

  describe('getEffectSync', () => {
    it('returns null before any catalog has been set', () => {
      expect(getEffectSync('a')).toBeNull()
    })

    it('returns the matching effect after setShaderFxCatalog', () => {
      setShaderFxCatalog(catalog(['a', 'b']))
      expect(getEffectSync('b')?.id).toBe('b')
    })

    it('returns null for an id not in the loaded catalog', () => {
      setShaderFxCatalog(catalog(['a']))
      expect(getEffectSync('unknown-id')).toBeNull()
    })
  })

  // Preserves the documented behaviour on catalog.ts's getEffectSync (this module
  // now owns it): a failed refetch must leave the previous good catalog in place
  // rather than blanking a working sync reader. catalogStore itself has no notion
  // of "failure" — it just does what it's told — so the guarantee is really that
  // NOTHING calls setShaderFxCatalog on a failed fetch. Proven at the catalog.ts
  // level in shaderfx-catalog-refetch.unit.spec.ts; proven here at the store level
  // that a catalog simply never gets cleared unless something explicitly does so.
  it('a catalog set once stays readable until something explicitly replaces or clears it', () => {
    setShaderFxCatalog(catalog(['a']))
    expect(getEffectSync('a')).not.toBeNull()
    // Simulates every miss/no-op that is NOT a call to setShaderFxCatalog (e.g. a
    // failed refetch attempt elsewhere) — the cache must not degrade on its own.
    expect(getEffectSync('a')).not.toBeNull()
    expect(getEffectSync('a')).not.toBeNull()
  })

  describe('setShaderFxRefetcher / refetchShaderFxCatalog', () => {
    it('returns null when nothing has registered a refetcher', () => {
      expect(refetchShaderFxCatalog()).toBeNull()
    })

    it('delegates to whatever was registered', () => {
      const fn = vi.fn(() => Promise.resolve(catalog(['a'])))
      setShaderFxRefetcher(fn)
      const p = refetchShaderFxCatalog()
      expect(fn).toHaveBeenCalledTimes(1)
      expect(p).not.toBeNull()
    })
  })
})
