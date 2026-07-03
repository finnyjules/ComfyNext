/** Both engines bill ~$1.00 per 30s of output; length = the audio length. */
export function estimateLipSyncCost(audioSeconds: number): number {
  const secs = Number.isFinite(audioSeconds) && audioSeconds > 0 ? audioSeconds : 5
  return Math.max(0.05, (secs / 30) * 1.0)
}
