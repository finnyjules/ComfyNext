import { describe, it, expect } from 'vitest'
import { validateVoiceSample } from '~/lib/voiceSample'

const MB = 1024 * 1024

describe('validateVoiceSample', () => {
  it('accepts a valid mp3 within size + duration bounds', () => {
    expect(validateVoiceSample({ name: 'me.mp3', size: 2 * MB }, 15)).toEqual({ ok: true })
  })
  it('accepts m4a and wav', () => {
    expect(validateVoiceSample({ name: 'a.m4a', size: MB }, 30).ok).toBe(true)
    expect(validateVoiceSample({ name: 'a.WAV', size: MB }, 30).ok).toBe(true)
  })
  it('rejects an unsupported format', () => {
    const r = validateVoiceSample({ name: 'notes.txt', size: MB }, 15)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/MP3|M4A|WAV|format/i)
  })
  it('rejects files over 20MB', () => {
    const r = validateVoiceSample({ name: 'big.wav', size: 21 * MB }, 30)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/20\s?MB|too large|size/i)
  })
  it('rejects clips shorter than 10s', () => {
    const r = validateVoiceSample({ name: 'short.mp3', size: MB }, 8)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/10\s?s|short/i)
  })
  it('rejects clips longer than 5 minutes', () => {
    const r = validateVoiceSample({ name: 'long.mp3', size: MB }, 5 * 60 + 1)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/5\s?min|long/i)
  })
  it('rejects when duration could not be decoded', () => {
    const r = validateVoiceSample({ name: 'x.mp3', size: MB }, null)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/read|decode|audio/i)
  })
})
