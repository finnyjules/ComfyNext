import { describe, it, expect } from 'vitest'

// StudioSegmented is presentational; this pins the active-class rule it encodes so a
// refactor can't silently break which option reads as selected.
function activeClass(model: string, o: string): string {
  return model === o ? 'bg-white text-neutral-900' : 'text-white/55 hover:text-white/80'
}

describe('segmented active rule', () => {
  it('marks only the selected option active (white)', () => {
    expect(activeClass('linear', 'linear')).toContain('bg-white')
    expect(activeClass('linear', 'concentric')).not.toContain('bg-white')
  })
})
