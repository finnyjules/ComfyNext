// frontend/app/lib/spacetype/imageTextures.ts
// Loads image ContentItem srcs into THREE.Texture, keyed by src, so the ring
// effect's `env.imageTextures.get(tile.src)` resolves to a real texture instead
// of `map: null`. Async on purpose — call BEFORE engine.build (which is
// synchronous and reads env.imageTextures at build time). Uses three.js/DOM
// (TextureLoader, Image element under the hood), which is why this stays out
// of tile.ts (kept pure/unit-testable with no canvas or three.js).

import * as THREE from 'three'
import type { ContentItem } from './tile'

/** Load every image-card ContentItem's src into a THREE.Texture, keyed by src.
 *  A src that fails to load is skipped (not fatal) — the ring effect already
 *  renders `map: null` for a missing entry, so a dropped image degrades to a
 *  blank tile rather than failing the whole build.
 *
 *  Task 1 (tile.ts) renamed the `image` ContentItem to `card` (`kind: 'card',
 *  fillKind: 'image'|'solid'|…`) — this filter is updated to match, or it selects
 *  NOTHING (no ContentItem has `kind === 'image'` anymore) and every image card
 *  preloads no texture, rendering blank. Only an image-kind card has a `src` worth
 *  loading; a solid/gradient/… card's `fill` is rendered by ring.ts directly, no
 *  texture to preload here. */
export async function loadImageTextures(items: ContentItem[]): Promise<Map<string, THREE.Texture>> {
  const srcs = Array.from(new Set(
    items
      .filter((i): i is Extract<ContentItem, { kind: 'card' }> => i.kind === 'card' && i.fillKind === 'image')
      .map(i => i.src)
      .filter((src): src is string => typeof src === 'string' && src.length > 0),
  ))
  const loader = new THREE.TextureLoader()
  const entries = await Promise.all(srcs.map(src => new Promise<[string, THREE.Texture] | null>(res => {
    loader.load(src, tex => { tex.colorSpace = THREE.SRGBColorSpace; res([src, tex]) }, undefined, () => res(null))
  })))
  const map = new Map<string, THREE.Texture>()
  for (const e of entries) if (e) map.set(e[0], e[1])
  return map
}
