import type { LipSyncSheet } from './types'

export function hydrateLipSyncSheet(raw: unknown): LipSyncSheet {
  const r = (raw && typeof raw === 'object') ? raw as Partial<LipSyncSheet> : {}
  const rf = (r.face && typeof r.face === 'object') ? r.face as Partial<LipSyncSheet['face']> : {}
  const rv = (r.voice && typeof r.voice === 'object') ? r.voice as Partial<LipSyncSheet['voice']> : {}
  return {
    face: {
      kind: rf.kind ?? 'image',
      src: rf.src ?? '',
      ...(rf.characterSlug ? { characterSlug: rf.characterSlug } : {}),
    },
    voice: {
      kind: rv.kind ?? 'tts',
      text: rv.text ?? '',
      voiceId: rv.voiceId ?? 'Wise_Woman',
      ...(rv.src ? { src: rv.src } : {}),
    },
    engine: r.engine ?? 'auto',
    resolution: r.resolution ?? '720p',
    syncMode: r.syncMode ?? 'cut_off',
  }
}
