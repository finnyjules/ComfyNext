// frontend/app/lib/spacetype/imageTextures.ts
// Loads image ContentItem srcs into THREE.Texture, keyed by src, so the ring
// effect's `env.imageTextures.get(tile.src)` resolves to a real texture instead
// of `map: null`. Async on purpose — call BEFORE engine.build (which is
// synchronous and reads env.imageTextures at build time). Uses three.js/DOM
// (TextureLoader, Image element under the hood), which is why this stays out
// of tile.ts (kept pure/unit-testable with no canvas or three.js).

import * as THREE from 'three'
import type { ContentItem } from './tile'

/** Load every image ContentItem's src into a THREE.Texture, keyed by src.
 *  A src that fails to load is skipped (not fatal) — the ring effect already
 *  renders `map: null` for a missing entry, so a dropped image degrades to a
 *  blank tile rather than failing the whole build. */
export async function loadImageTextures(items: ContentItem[]): Promise<Map<string, THREE.Texture>> {
  const srcs = Array.from(new Set(items.filter(i => i.kind === 'image').map(i => (i as any).src)))
  const loader = new THREE.TextureLoader()
  const entries = await Promise.all(srcs.map(src => new Promise<[string, THREE.Texture] | null>(res => {
    loader.load(src, tex => { tex.colorSpace = THREE.SRGBColorSpace; res([src, tex]) }, undefined, () => res(null))
  })))
  const map = new Map<string, THREE.Texture>()
  for (const e of entries) if (e) map.set(e[0], e[1])
  return map
}
