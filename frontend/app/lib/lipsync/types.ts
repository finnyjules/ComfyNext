export interface ValidationIssue { level: 'error' | 'warning'; code: string; message: string }

export type FaceKind = 'character' | 'image' | 'video'
export type VoiceKind = 'tts' | 'audio'

export interface LipSyncSheet {
  face: { kind: FaceKind; src: string; characterSlug?: string }
  voice: { kind: VoiceKind; text?: string; voiceId?: string; src?: string }
  engine: 'auto' | 'fabric' | 'sync'
  resolution: '480p' | '720p' | '1080p'
  syncMode: 'cut_off' | 'loop' | 'bounce' | 'silence' | 'remap'
}
