import { describe, it, expect } from 'vitest'
import { LORA_LIBRARY } from '~/data/lora-library'
import { USE_CASE_TAGS } from '~/data/house-styles'

describe('community LoRA library use-case tags', () => {
  it('every entry is tagged with ≥1 known use case', () => {
    for (const e of LORA_LIBRARY) {
      expect(e.useCases?.length, e.label).toBeGreaterThan(0)
      for (const t of e.useCases!) expect(USE_CASE_TAGS, `${e.label}: ${t}`).toContain(t)
    }
  })
})
