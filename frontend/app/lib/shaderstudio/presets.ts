// frontend/app/lib/shaderstudio/presets.ts
import type { StudioAdjust } from './types'

export interface DuotonePreset { name: string; ink: string; paper: string }
export interface AdjustPreset { name: string; values: Partial<Omit<StudioAdjust, 'enabled'>> }

export const DUOTONE_PRESETS: DuotonePreset[] = [
  { name: 'Mono', ink: '#000000', paper: '#ffffff' },
  { name: 'Indigo', ink: '#1a1a2e', paper: '#e8e8f5' },
  { name: 'Blood', ink: '#3a0a0a', paper: '#f3d9c0' },
  { name: 'Forest', ink: '#0c2a1f', paper: '#dff0e2' },
  { name: 'Sepia', ink: '#2b1a08', paper: '#f0e2c8' },
  { name: 'Ocean', ink: '#06283d', paper: '#dff6ff' },
  { name: 'Berry', ink: '#2d0a2e', paper: '#ffd9f0' },
  { name: 'Ember', ink: '#1a1206', paper: '#ffb347' },
]

export const ADJUST_PRESETS: AdjustPreset[] = [
  { name: 'Neutral', values: { exposure: 0, brightness: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, tint: 0 } },
  { name: 'Punchy', values: { exposure: -0.15, contrast: 0.25, saturation: 0.2 } },
  { name: 'Faded', values: { contrast: -0.2, saturation: -0.25, brightness: 0.08 } },
  { name: 'Warm', values: { temperature: 0.3, saturation: 0.1 } },
  { name: 'Cool', values: { temperature: -0.3, tint: -0.1 } },
  { name: 'B&W', values: { saturation: -1, contrast: 0.15 } },
]

/** Reset to neutral, then apply the preset's overrides. Keeps `enabled` as-is. */
export function applyAdjustPreset(adjust: StudioAdjust, preset: AdjustPreset): void {
  const neutral = ADJUST_PRESETS[0]!.values
  Object.assign(adjust, neutral, preset.values)
}
