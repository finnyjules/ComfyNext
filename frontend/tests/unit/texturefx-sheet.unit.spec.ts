import { describe, it, expect } from 'vitest'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import {
  SHEET_PRESET_CUSTOM, SHEET_PRESET_TILE, SHEET_PRESETS, SHEET_SIZES, TILE_PX_OPTIONS,
  fitLetterbox, isSheetFramed, isTileable, repeatsFor, sheetFromParams, tilePositions,
} from '~/lib/texturefx/sheet'
import type { Params } from '~/lib/spacetype/effect'

// The whole point of the Output tab is that it changes NOTHING until you touch it.
// Every pattern already on a canvas was saved without these keys.
describe('sheetFromParams — back compatibility', () => {
  it('defaults to a 1024 square sheet from a 1024 tile', () => {
    expect(sheetFromParams(textureDefaults())).toEqual({ w: 1024, h: 1024, tile: 1024 })
  })

  it('resolves a legacy params object with no sheet keys identically', () => {
    // How loadParams() rehydrates a pattern saved before this feature existed.
    const legacy = { mode: 'procedural', motif: 'checker', cells: 8, seed: 3 } as unknown as Params
    const merged = { ...textureDefaults(), ...legacy }
    expect(sheetFromParams(merged)).toEqual({ w: 1024, h: 1024, tile: 1024 })
  })

  it('follows the tile size for the Tile preset', () => {
    const p = { ...textureDefaults(), sheetPreset: SHEET_PRESET_TILE, tilePx: '2048' } as Params
    expect(sheetFromParams(p)).toEqual({ w: 2048, h: 2048, tile: 2048 })
  })
})

describe('sheetFromParams — presets and custom', () => {
  it('reads the size table for a fixed preset', () => {
    const p = { ...textureDefaults(), sheetPreset: '1920 × 1080 (16:9)', tilePx: '512' } as Params
    expect(sheetFromParams(p)).toEqual({ w: 1920, h: 1080, tile: 512 })
  })

  // Space Type's dimsFromKey has the opposite bug: it consults the preset table for
  // Custom and silently returns stale dimensions. Custom lives in W/H, full stop.
  it('reads W/H for Custom and never the preset table', () => {
    const p = { ...textureDefaults(), sheetPreset: SHEET_PRESET_CUSTOM, sheetW: 1500, sheetH: 700 } as Params
    expect(sheetFromParams(p)).toEqual({ w: 1500, h: 700, tile: 1024 })
  })

  it('falls back to a square tile sheet for an unknown preset label', () => {
    const p = { ...textureDefaults(), sheetPreset: 'Nonsense', tilePx: '512' } as Params
    expect(sheetFromParams(p)).toEqual({ w: 512, h: 512, tile: 512 })
  })

  // isSheetFramed and sheetFromParams must recognise presets identically — an
  // unrecognised label resolves to a square tile sheet, so it must also read as
  // "not framed", or the node card letterboxes a square swatch into a 3:2 frame.
  it('agrees with sheetFromParams on an unrecognised preset label', () => {
    const p = { ...textureDefaults(), sheetPreset: 'Nonsense', tilePx: '512' } as Params
    expect(isSheetFramed(p)).toBe(false)
    expect(sheetFromParams(p)).toEqual({ w: 512, h: 512, tile: 512 })
  })

  it('clamps a garbage custom size instead of producing NaN', () => {
    const p = { ...textureDefaults(), sheetPreset: SHEET_PRESET_CUSTOM, sheetW: 999999, sheetH: 0 } as Params
    expect(sheetFromParams(p)).toEqual({ w: 8192, h: 64, tile: 1024 })
  })
})

describe('repeatsFor / isTileable', () => {
  it('reports fractional repeats', () => {
    expect(repeatsFor({ w: 1920, h: 1080, tile: 512 })).toEqual({ x: 3.75, y: 2.109375 })
  })

  it('is tileable only when both axes are whole tiles', () => {
    expect(isTileable({ w: 2048, h: 2048, tile: 512 })).toBe(true)
    expect(isTileable({ w: 1920, h: 1080, tile: 512 })).toBe(false)
    expect(isTileable({ w: 1024, h: 1024, tile: 1024 })).toBe(true)
  })
})

describe('isSheetFramed', () => {
  it('is false for the Tile preset — that output is a material, not a framed sheet', () => {
    expect(isSheetFramed({ ...textureDefaults(), sheetPreset: SHEET_PRESET_TILE } as Params)).toBe(false)
  })

  it('is true once a real sheet is chosen', () => {
    expect(isSheetFramed({ ...textureDefaults(), sheetPreset: '1080 × 1920 (9:16)' } as Params)).toBe(true)
    expect(isSheetFramed({ ...textureDefaults(), sheetPreset: SHEET_PRESET_CUSTOM } as Params)).toBe(true)
  })
})

describe('fitLetterbox', () => {
  it('fits a portrait sheet by height and centres it horizontally', () => {
    expect(fitLetterbox({ w: 1080, h: 1920, tile: 512 }, 220, 148)).toEqual({ w: 83, h: 148, x: 69, y: 0 })
  })

  it('fits a wide sheet by width and centres it vertically', () => {
    expect(fitLetterbox({ w: 1920, h: 1080, tile: 512 }, 220, 148)).toEqual({ w: 220, h: 124, x: 0, y: 12 })
  })
})

describe('tilePositions', () => {
  it('emits exactly one op for a single-tile sheet', () => {
    expect(tilePositions({ w: 1024, h: 1024, tile: 1024 }, 1024, 1024))
      .toEqual([{ x: 0, y: 0, size: 1024 }])
  })

  it('covers a partial repeat by overdrawing past the edge', () => {
    // 1920/512 = 3.75 across, 1080/512 = 2.11 down -> 4 x 3 draws, last ones cropped.
    const ops = tilePositions({ w: 1920, h: 1080, tile: 512 }, 1920, 1080)
    expect(ops).toHaveLength(12)
    expect(ops[0]).toEqual({ x: 0, y: 0, size: 512 })
    expect(ops[11]).toEqual({ x: 1536, y: 1024, size: 512 })
  })

  it('scales the tile when drawing into a smaller destination', () => {
    // Half-size destination -> half-size tiles, same repeat count. This is what keeps
    // a 4K sheet preview from allocating a 4K canvas.
    const ops = tilePositions({ w: 2048, h: 1024, tile: 512 }, 1024, 512)
    expect(ops).toHaveLength(8)
    expect(ops[0]).toEqual({ x: 0, y: 0, size: 256 })
  })
})

describe('control declarations', () => {
  it('offers only tile sizes that keep the dither patterns seamless', () => {
    // DITHER_PERIOD tops out at 128 (blue noise 2x); every option must be a
    // multiple of 64 or stylizeTile seams at the tile edge.
    for (const opt of TILE_PX_OPTIONS) expect(Number(opt) % 64).toBe(0)
  })

  it('lists Tile first and Custom last', () => {
    expect(SHEET_PRESETS[0]).toBe(SHEET_PRESET_TILE)
    expect(SHEET_PRESETS[SHEET_PRESETS.length - 1]).toBe(SHEET_PRESET_CUSTOM)
  })

  it('declares the four Output controls in the Output group', () => {
    const keys = TEXTURE_CONTROLS.filter(c => c.group === 'Output').map(c => c.key)
    expect(keys).toEqual(['sheetPreset', 'sheetW', 'sheetH', 'tilePx'])
  })
})

// SHEET_SIZES keys are BOTH the UI label and the persisted identity: a saved
// pattern's params.sheetPreset is the literal string. Renaming a label, or
// normalising the × (U+00D7) or any other punctuation to ASCII, makes every
// already-saved pattern using that preset fall through the unknown-label branch
// in sheetFromParams and silently re-export at 1024x1024 instead of its real
// size. These assertions lock the exact strings so a copy-edit fails CI instead
// of quietly corrupting exported dimensions for existing users. If you actually
// need to rename a label, that is a data migration, not a rename.
describe('SHEET_SIZES / SHEET_PRESETS — persisted identity', () => {
  it('locks the exact preset label list', () => {
    expect(SHEET_PRESETS).toEqual([
      'Tile · square',
      '1920 × 1080 (16:9)',
      '1080 × 1920 (9:16)',
      '2048 × 2048',
      '3840 × 2160 (4K)',
      'Custom',
    ])
  })

  it('locks the exact SHEET_SIZES keys and dimensions', () => {
    expect(SHEET_SIZES).toEqual({
      '1920 × 1080 (16:9)': [1920, 1080],
      '1080 × 1920 (9:16)': [1080, 1920],
      '2048 × 2048': [2048, 2048],
      '3840 × 2160 (4K)': [3840, 2160],
    })
  })
})
