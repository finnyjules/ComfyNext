import type { LipSyncSheet, ValidationIssue } from './types'

export function resolveEngine(sheet: LipSyncSheet): 'fabric' | 'sync' {
  if (sheet.engine === 'fabric' || sheet.engine === 'sync') return sheet.engine
  return sheet.face.kind === 'video' ? 'sync' : 'fabric'
}

/** The resolved audio src: an uploaded/existing clip, empty for a TTS voice
 *  (whose audio is generated at Generate time from voice.text + voiceId). */
function voiceSrc(sheet: LipSyncSheet): string {
  return sheet.voice.src ?? ''
}

/** Whether the sheet has a usable voice: an uploaded/existing clip, OR a TTS
 *  voice with non-empty text (its audio resolves at Generate time). */
function hasVoice(sheet: LipSyncSheet): boolean {
  if (sheet.voice.kind === 'tts') return !!(sheet.voice.text && sheet.voice.text.trim())
  return !!(sheet.voice.src && sheet.voice.src.trim())
}

export function compileLipSync(sheet: LipSyncSheet): {
  modelOptions: Record<string, unknown>; engine: string; resolution: string; issues: ValidationIssue[]
} {
  const issues: ValidationIssue[] = []
  const engine = resolveEngine(sheet)
  const face = sheet.face.src.trim()
  // audio is the resolved clip URL (empty for TTS until Generate fills it); the
  // "has voice" gate uses hasVoice() so a typed TTS line doesn't read as missing.
  const audio = voiceSrc(sheet).trim()

  if (!face) issues.push({ level: 'error', code: 'no-face', message: 'Pick a character, image, or video to drive.' })
  if (!hasVoice(sheet)) issues.push({ level: 'error', code: 'no-voice', message: 'Add a voice — type a line, or upload audio.' })
  if (sheet.face.kind === 'video' && sheet.engine === 'fabric') {
    issues.push({ level: 'warning', code: 'video-needs-sync', message: 'A video face uses the sync engine; Fabric is image-only.' })
  }

  const modelOptions: Record<string, unknown> = { engine, resolution: sheet.resolution, audio }
  if (engine === 'sync') { modelOptions.face_video = face; modelOptions.sync_mode = sheet.syncMode }
  else { modelOptions.face_image = face }

  return { modelOptions, engine, resolution: sheet.resolution, issues }
}
