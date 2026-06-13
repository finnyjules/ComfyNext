/**
 * voiceSample — client-side validation for a voice-clone audio sample, run
 * BEFORE upload so we never send a sample minimax/voice-cloning would reject.
 * Constraints come from the model: MP3/M4A/WAV, <20MB, 10s–5min.
 */

export const VOICE_SAMPLE_MAX_BYTES = 20 * 1024 * 1024
export const VOICE_SAMPLE_MIN_SECONDS = 10
export const VOICE_SAMPLE_MAX_SECONDS = 5 * 60
const ALLOWED_EXT = ['mp3', 'm4a', 'wav']

export interface VoiceSampleResult {
  ok: boolean
  error?: string
}

/**
 * @param file        the chosen file's name + size (a File satisfies this)
 * @param durationSec decoded duration in seconds, or null if it couldn't be read
 */
export function validateVoiceSample(
  file: { name: string; size: number },
  durationSec: number | null,
): VoiceSampleResult {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXT.includes(ext)) {
    return { ok: false, error: 'Unsupported format — use an MP3, M4A, or WAV file.' }
  }
  if (file.size > VOICE_SAMPLE_MAX_BYTES) {
    return { ok: false, error: 'File is too large — keep it under 20 MB.' }
  }
  if (durationSec == null || !Number.isFinite(durationSec)) {
    return { ok: false, error: "Couldn't read the audio — try a different file." }
  }
  if (durationSec < VOICE_SAMPLE_MIN_SECONDS) {
    return { ok: false, error: 'Clip is too short — use at least 10 seconds of audio.' }
  }
  if (durationSec > VOICE_SAMPLE_MAX_SECONDS) {
    return { ok: false, error: 'Clip is too long — keep it under 5 minutes.' }
  }
  return { ok: true }
}
