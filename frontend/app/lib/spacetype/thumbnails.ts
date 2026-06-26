import { SpaceTypeEngine } from './engine'
import { SPACE_TYPE_EFFECTS } from './effects'
import { defaultsFromControls } from './effect'
import { defaultSpaceTypeState, texOptsFromState, ensureSpaceTypeFont, type SpaceTypeState } from './state'
import { detectWebGL } from './webgl'

const THUMB_W = 320, THUMB_H = 200, SAMPLE_WORD = 'Type'
let _cache: Promise<Record<string, string>> | null = null

/** Render each effect's default look once (one shared offscreen engine) → cached {id: objectURL}.
 *  Memoized for the session. No WebGL → {} (cards fall back to label-only). */
export function effectThumbnails(): Promise<Record<string, string>> {
  // .catch so a (currently unreachable) generate() failure can't poison the memoized cache with a
  // rejected promise — callers always get a usable map (empty → label-only cards).
  if (!_cache) _cache = generate().catch(() => ({}))
  return _cache
}

async function generate(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!detectWebGL()) return out
  const base = defaultSpaceTypeState()
  await ensureSpaceTypeFont(String(base.params.font))
  const canvas = document.createElement('canvas')
  let engine: SpaceTypeEngine | null = null
  try {
    engine = new SpaceTypeEngine(canvas, {
      effect: SPACE_TYPE_EFFECTS[0]!, width: THUMB_W, height: THUMB_H,
      fps: 30, loopDuration: 6, alpha: false, bgColor: base.bgColor,
    })
    for (const e of SPACE_TYPE_EFFECTS) {
      try {
        const params = defaultsFromControls(e.controls)
        params.text = SAMPLE_WORD
        const state: SpaceTypeState = { ...base, effectId: e.id, params }
        engine.setEffect(e)
        engine.build(params, texOptsFromState(state))
        engine.renderFrame(0, params)
        out[e.id] = URL.createObjectURL(await engine.frameToBlob())
      } catch { /* skip this effect's thumbnail */ }
    }
  } finally {
    engine?.dispose()
  }
  return out
}

/** Test-only: reset the memoized cache. */
export function __resetThumbnailCache(): void { _cache = null }
