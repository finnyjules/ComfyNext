import { describe, it, expect, vi } from 'vitest'
import { useLipSync } from '~/composables/useLipSync'

describe('useLipSync', () => {
  it('recompiles on update and persists', () => {
    const persist = vi.fn()
    const { sheet, result, setFace, setVoice } = useLipSync({}, persist)
    expect(result.value.issues.some(i => i.level === 'error')).toBe(true) // empty → errors
    setFace({ kind: 'image', src: '/view?filename=a.png&type=input' })
    setVoice({ kind: 'audio', src: '/view?filename=v.mp3&type=input' })
    expect(result.value.engine).toBe('fabric')
    expect(result.value.issues.filter(i => i.level === 'error')).toHaveLength(0)
    expect(persist).toHaveBeenCalled()
    expect(sheet.value.face.src).toContain('a.png')
  })
})
