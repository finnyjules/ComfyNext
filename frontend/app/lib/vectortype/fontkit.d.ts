/**
 * Minimal ambient types for `fontkit@2`, which ships no `.d.ts` (the published
 * @types/fontkit describes v1 and does not match). Without this, every
 * `import * as fontkit from 'fontkit'` is a TS7016 implicit-any error.
 *
 * Only what Vector Type actually calls is typed; the glyph/path surface stays
 * loose on purpose rather than being guessed at. Note there is NO default
 * export — `import fontkit from 'fontkit'` is undefined at runtime.
 */
declare module 'fontkit' {
  export interface FontkitVariationAxis {
    name?: string
    min: number
    default: number
    max: number
  }

  export interface FontkitFont {
    unitsPerEm: number
    variationAxes?: Record<string, FontkitVariationAxis>
    namedVariations?: Record<string, Record<string, number>>
    /** An instance of this font at the given axis coordinates. */
    getVariation(coords: Record<string, number>): FontkitFont
    glyphsForString(str: string): any[]
    layout(str: string): any
    [key: string]: any
  }

  export function create(buffer: Uint8Array | ArrayBufferView, postscriptName?: string): FontkitFont
  export function openSync(filename: string, postscriptName?: string): FontkitFont
}
