/**
 * Replicate bytedance/seedance-2.0 list prices per output second (verified
 * 2026-07-01, docs/superpowers/specs/2026-07-01-costs-and-pricing-model.md).
 * Column 2 applies when any video reference is attached (`video_in` tier).
 * Provider COGS shown to the user as a "~$" estimate until the credit system
 * (accounts/billing spec §9.1) replaces it with a credit price.
 */
import type { ShotSheet } from '~/lib/shotdirector/types'

const PER_SECOND_USD: Record<string, [plain: number, videoRef: number]> = {
  '480p': [0.08, 0.10],
  '720p': [0.18, 0.22],
  '1080p': [0.45, 0.55],
  '4k': [1.00, 1.25],
}

export function estimateShotUSD(sheet: ShotSheet): number {
  const tier = PER_SECOND_USD[sheet.format.resolution.toLowerCase()] ?? PER_SECOND_USD['1080p']!
  const hasVideoRef = sheet.mode === 'reference' && sheet.references.some(r => r.kind === 'video')
  // Same effective-duration rule as buildFilmShotPatch in dispatch.ts:
  // durationS <= 0 covers -1 ("Auto") and any other invalid/unset value,
  // which map to the profile default (5s) at dispatch time. Pricing must
  // use the same effective duration or Auto prices as a negative number.
  const dur = sheet.format.durationS <= 0 ? 5 : sheet.format.durationS
  return (hasVideoRef ? tier[1] : tier[0]) * dur
}

export function formatShotUSD(sheet: ShotSheet): string {
  return `~$${estimateShotUSD(sheet).toFixed(2)}`
}
