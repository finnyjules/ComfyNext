import { describe, expect, it } from 'vitest'
import { buildScenePrompt } from '~/composables/useSheetGeneration'
import type { CharacterShotScene } from '~/data/character-shot-scenes'

const scene: CharacterShotScene = {
  prompt: 'close-up portrait, facing camera directly, neutral expression',
  framing: 'closeup',
}

describe('buildScenePrompt', () => {
  it('joins trigger + descriptor + scene prompt, comma-separated', () => {
    expect(buildScenePrompt(scene, { trigger: 'ohwx woman', descriptor: 'shaved head, leather jacket' }))
      .toBe('ohwx woman, shaved head, leather jacket, close-up portrait, facing camera directly, neutral expression')
  })

  it('descriptor only (no trigger) — photo mode with a variant descriptor', () => {
    expect(buildScenePrompt(scene, { descriptor: 'red dress' }))
      .toBe('red dress, close-up portrait, facing camera directly, neutral expression')
  })

  it('trigger only (no descriptor) — LoRA mode, default variant', () => {
    expect(buildScenePrompt(scene, { trigger: 'ohwx woman' }))
      .toBe('ohwx woman, close-up portrait, facing camera directly, neutral expression')
  })

  it('scene only — no trigger, no descriptor', () => {
    expect(buildScenePrompt(scene, {})).toBe('close-up portrait, facing camera directly, neutral expression')
  })

  it('ignores a null trigger (loraGen source shape uses trigger: string | null)', () => {
    expect(buildScenePrompt(scene, { trigger: null, descriptor: undefined }))
      .toBe('close-up portrait, facing camera directly, neutral expression')
  })
})
