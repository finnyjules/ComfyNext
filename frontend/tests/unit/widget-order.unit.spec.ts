import { describe, it, expect } from 'vitest'
import { isMultilineTextWidget, promptFirst } from '../../app/lib/canvas/widgetOrder'

const w = (name: string, type = 'STRING', multiline?: boolean) =>
  ({ name, type, ...(multiline == null ? {} : { multiline }) })

describe('isMultilineTextWidget', () => {
  it('trusts an explicit multiline flag over the name', () => {
    expect(isMultilineTextWidget(w('prompt', 'STRING', false))).toBe(false)
    expect(isMultilineTextWidget(w('lora_url', 'STRING', true))).toBe(true)
  })

  it('falls back to the name when the flag is absent', () => {
    expect(isMultilineTextWidget(w('prompt'))).toBe(true)
    expect(isMultilineTextWidget(w('negative_text'))).toBe(true)
    expect(isMultilineTextWidget(w('lora_url'))).toBe(false)
  })

  it('is only ever true for STRING', () => {
    expect(isMultilineTextWidget(w('prompt', 'INT'))).toBe(false)
  })

  it('tolerates nothing', () => {
    expect(isMultilineTextWidget(undefined)).toBe(false)
    expect(isMultilineTextWidget(null)).toBe(false)
  })
})

describe('promptFirst', () => {
  it('lifts the prompt above widgets declared before it', () => {
    const out = promptFirst([w('model', 'COMBO'), w('prompt'), w('steps', 'INT')])
    expect(out.map(e => e.widget.name)).toEqual(['prompt', 'model', 'steps'])
  })

  it('carries the ORIGINAL index, because widgetsValues is positional', () => {
    const out = promptFirst([w('model', 'COMBO'), w('prompt'), w('steps', 'INT')])
    expect(out.map(e => e.i)).toEqual([1, 0, 2])
  })

  it('leaves declared order alone when there is no prompt', () => {
    const out = promptFirst([w('model', 'COMBO'), w('steps', 'INT')])
    expect(out.map(e => e.widget.name)).toEqual(['model', 'steps'])
    expect(out.map(e => e.i)).toEqual([0, 1])
  })

  it('is stable across several prompts', () => {
    const out = promptFirst([w('a', 'INT'), w('prompt'), w('b', 'INT'), w('negative_prompt')])
    expect(out.map(e => e.widget.name)).toEqual(['prompt', 'negative_prompt', 'a', 'b'])
    expect(out.map(e => e.i)).toEqual([1, 3, 0, 2])
  })

  it('does not reorder a prompt that is already first', () => {
    const out = promptFirst([w('prompt'), w('model', 'COMBO')])
    expect(out.map(e => e.i)).toEqual([0, 1])
  })

  it('returns an empty array for nothing', () => {
    expect(promptFirst(undefined)).toEqual([])
    expect(promptFirst([])).toEqual([])
  })
})
