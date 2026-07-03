import type { LipSyncSheet } from './types'

export function hydrateLipSyncSheet(raw: unknown): LipSyncSheet {
  const r = (raw && typeof raw === 'object') ? raw as Partial<LipSyncSheet> : {}
  return {
    face: r.face && typeof r.face === 'object' ? { kind: 'image', src: '', ...r.face } as LipSyncSheet['face']
                                               : { kind: 'image', src: '' },
    voice: r.voice && typeof r.voice === 'object' ? { kind: 'tts', ...r.voice } as LipSyncSheet['voice']
                                                  : { kind: 'tts', text: '', voiceId: 'Wise_Woman' },
    engine: r.engine ?? 'auto',
    resolution: r.resolution ?? '720p',
    syncMode: r.syncMode ?? 'cut_off',
  }
}
