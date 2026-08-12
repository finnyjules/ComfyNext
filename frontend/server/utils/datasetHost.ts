/**
 * Where to park a training dataset zip so the trainer can fetch it.
 *
 * Replicate's files API rejects anything over 100 MB with a 413 ("File too
 * large"); their guidance for bigger inputs is to host it elsewhere and pass a
 * URL. `input_images` is just a URL string (see trainingProviders.ts), so a fal
 * CDN URL works there exactly as it already does for `voice_file`.
 *
 * Replicate stays the default because its file URLs are auth-gated, while fal's
 * are public (unguessable, but public). Only reach for fal when the zip can't
 * fit on Replicate at all.
 */
export type DatasetHost = 'replicate' | 'fal'

/** Replicate's documented ceiling for the files API. */
export const REPLICATE_LIMIT_BYTES = 100 * 1024 * 1024

/** Our routing threshold — headroom for multipart framing overhead. */
export const REPLICATE_SAFE_BYTES = 95 * 1024 * 1024

export interface HostChoice {
  host: DatasetHost | null
  /** Set only when `host` is null: why nothing can take this dataset. */
  reason?: string
}

export function pickDatasetHost(
  bytes: number,
  opts: { falAvailable: boolean },
): HostChoice {
  if (bytes <= REPLICATE_SAFE_BYTES) return { host: 'replicate' }
  if (opts.falAvailable) return { host: 'fal' }

  const mb = Math.round(bytes / 1024 / 1024)
  return {
    host: null,
    reason: `Dataset is ${mb} MB — over Replicate's 100 MB limit. Set FAL_KEY in frontend/.env to upload datasets this large, or use fewer/smaller images.`,
  }
}
