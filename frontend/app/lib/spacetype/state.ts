import { ribbonEffect, buildRibbonLabel } from './effects/ribbon'
import { defaultsFromControls } from './effect'
import { VARIABLE_FONTS } from '~/data/variable-fonts'
import type { SpaceTypeState } from '~~/shared/spacetype/state'

export type { SpaceTypeState } from '~~/shared/spacetype/state'

// Shared Space Type editor/node state. The modal (SpaceTypeSurface) keeps its
// own inline copy of this logic; this module exists so the node card preview
// can rebuild the same scene from the saved config without duplicating it.

export const DIMS: Record<string, [number, number]> = {
  '1920 × 1080 (16:9)': [1920, 1080],
  '1080 × 1920 (9:16)': [1080, 1920],
  '1080 × 1080 (1:1)': [1080, 1080],
  '1280 × 720 (16:9)': [1280, 720],
  '960 × 540 (16:9)': [960, 540],
}

export function defaultSpaceTypeState(): SpaceTypeState {
  return {
    effectId: 'ribbon',
    params: defaultsFromControls(ribbonEffect.controls),
    gradientStops: [
      { color: '#3b5bff', on: true }, { color: '#ff3b3b', on: true },
      { color: '#ffd23b', on: true }, { color: '#ffffff', on: false },
    ],
    fps: 30, loopDuration: 6, dimsKey: '960 × 540 (16:9)', transparent: false, bgColor: '#0e0e10',
  }
}

export function dimsFromKey(key: string): [number, number] { return DIMS[key] ?? [960, 540] }

const loadedFontIds = new Set<string>()
export async function ensureSpaceTypeFont(id: string): Promise<void> {
  const f = VARIABLE_FONTS.find(v => v.id === id) ?? VARIABLE_FONTS[0]
  if (!f) return
  if (!loadedFontIds.has(f.id)) {
    if (typeof document !== 'undefined' && !document.querySelector(`link[data-stg-font="${f.id}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = f.cssUrl; link.setAttribute('data-stg-font', f.id)
      document.head.appendChild(link)
    }
    loadedFontIds.add(f.id)
  }
  try { await document.fonts.load(`700 32px "${f.family}"`) } catch { /* best-effort */ }
}

export function texOptsFromState(s: SpaceTypeState) {
  const f = VARIABLE_FONTS.find(v => v.id === String(s.params.font)) ?? VARIABLE_FONTS[0]
  return {
    label: buildRibbonLabel(String(s.params.text), 'upper'),
    fontFamily: f?.family ?? 'Inter',
    // STG-style names (typeWeight/typeYScale/typeXScale) with fallbacks so effects
    // that still use typeHeight keep working unchanged.
    fontWeight: Number(s.params.typeWeight ?? 700),
    axes: { wght: Number(s.params.typeWeight ?? 700) },
    typeColor: String(s.params.typeColor),
    fontSizePx: Number(s.params.typeYScale ?? s.params.typeHeight ?? 180),
    scaleX: Number(s.params.typeXScale ?? 1),
    tracking: Number(s.params.tracking),
    strokeColor: '#000000',
    strokeWidth: Number(s.params.typeStroke),
    gradientStops: s.gradientStops.map(g => ({ ...g })),
    gradientOn: String(s.params.gradientMode) === 'on',
    uRepeat: Number(s.params.textRepeat),
  }
}
