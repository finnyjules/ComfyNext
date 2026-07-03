import { describe, it, expect } from 'vitest'
import { hydrateLipSyncSheet } from '~/lib/lipsync/hydrate'
import { resolveEngine, compileLipSync } from '~/lib/lipsync/compile'

const base = () => hydrateLipSyncSheet({})

describe('resolveEngine', () => {
  it('image face → fabric', () => {
    const s = { ...base(), face: { kind: 'image', src: '/view?filename=a.png&type=input' } }
    expect(resolveEngine(s as any)).toBe('fabric')
  })
  it('video face → sync', () => {
    const s = { ...base(), face: { kind: 'video', src: '/view?filename=v.mp4&type=input' } }
    expect(resolveEngine(s as any)).toBe('sync')
  })
  it('manual override wins', () => {
    const s = { ...base(), engine: 'sync', face: { kind: 'image', src: 'x' } }
    expect(resolveEngine(s as any)).toBe('sync')
  })
})

describe('compileLipSync', () => {
  it('image + audio → fabric model_options', () => {
    const s = {
      ...base(),
      face: { kind: 'image', src: '/view?filename=a.png&type=input' },
      voice: { kind: 'audio', src: '/view?filename=v.mp3&type=input' },
    }
    const out = compileLipSync(s as any)
    expect(out.engine).toBe('fabric')
    expect(out.modelOptions.face_image).toBe('/view?filename=a.png&type=input')
    expect(out.modelOptions.audio).toBe('/view?filename=v.mp3&type=input')
    expect(out.modelOptions.face_video).toBeUndefined()
    expect(out.issues.filter(i => i.level === 'error')).toHaveLength(0)
  })
  it('video + audio → sync model_options with sync_mode', () => {
    const s = {
      ...base(),
      face: { kind: 'video', src: '/view?filename=v.mp4&type=input' },
      voice: { kind: 'audio', src: '/view?filename=v.mp3&type=input' },
      syncMode: 'loop',
    }
    const out = compileLipSync(s as any)
    expect(out.engine).toBe('sync')
    expect(out.modelOptions.face_video).toBe('/view?filename=v.mp4&type=input')
    expect(out.modelOptions.sync_mode).toBe('loop')
  })
  it('no face → error issue', () => {
    const s = { ...base(), voice: { kind: 'audio', src: 'x' } }
    expect(compileLipSync(s as any).issues.some(i => i.level === 'error')).toBe(true)
  })
  it('no voice → error issue', () => {
    const s = { ...base(), face: { kind: 'image', src: 'x' } }
    expect(compileLipSync(s as any).issues.some(i => i.level === 'error')).toBe(true)
  })
  it('TTS voice with text is a valid voice (audio resolves at Generate time)', () => {
    const s = {
      ...base(),
      face: { kind: 'image', src: '/view?filename=a.png&type=input' },
      voice: { kind: 'tts', text: 'Hello there.', voiceId: 'Wise_Woman' },
    }
    const out = compileLipSync(s as any)
    // No no-voice error despite voice.src being empty — the text drives TTS.
    expect(out.issues.filter(i => i.level === 'error')).toHaveLength(0)
    // Compiled audio stays empty here; the Generate handler injects the /view URL.
    expect(out.modelOptions.audio).toBe('')
  })
  it('TTS voice with only whitespace text → error issue', () => {
    const s = {
      ...base(),
      face: { kind: 'image', src: 'x' },
      voice: { kind: 'tts', text: '   ', voiceId: 'Wise_Woman' },
    }
    expect(compileLipSync(s as any).issues.some(i => i.code === 'no-voice')).toBe(true)
  })
})
