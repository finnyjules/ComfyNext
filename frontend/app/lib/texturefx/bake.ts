import { textureFx } from '~/lib/texturefx/renderer'
import { stylizeTile } from '~/lib/texturefx/stylize'
import { drawSheet, sheetFromParams, type Sheet } from '~/lib/texturefx/sheet'
import type { Params } from '~/lib/spacetype/effect'

// The single full-resolution bake. Both exporters — the studio's Download/As-image
// and the node's headless cascade bake — call this, so they cannot disagree about
// what a pattern exports.
//
// Deliberately NOT in sheet.ts: controls.ts imports sheet.ts and is reachable from
// the Collection resolver's dynamic import graph, which must stay free of the GL
// renderer (see the header comment in types.ts).

/**
 * Render the seamless tile at its full size, stylize it (dither/posterize/duotone),
 * then repeat-fill the sheet. The tile is always square so cells stay undistorted;
 * the sheet's aspect comes from how much of that repeating field is kept. Tile sizes
 * are multiples of 64 so dither stays seamless across the repeat.
 */
export function renderSheetCanvas(p: Params, s: Sheet = sheetFromParams(p)): HTMLCanvasElement {
  const tile = stylizeTile(textureFx.render(p, s.tile, s.tile, 0), p, s.tile, s.tile)
  const out = document.createElement('canvas')
  out.width = s.w
  out.height = s.h
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  drawSheet(ctx, tile, s, s.w, s.h)
  return out
}

/** PNG-encode a full-resolution sheet. */
export async function bakeSheetBlob(p: Params): Promise<Blob> {
  const out = renderSheetCanvas(p)
  return await new Promise<Blob>((res, rej) =>
    out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}
