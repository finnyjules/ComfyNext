import { describe, it, expect } from 'vitest'
import { inputNameFromViewUrl } from '../../shared/brand/assets'

describe('inputNameFromViewUrl', () => {
  it('extracts the filename from an input view URL', () => {
    expect(inputNameFromViewUrl('/view?filename=brand_logo.png&type=input')).toBe('brand_logo.png')
    expect(inputNameFromViewUrl('/view?filename=sub%2Flogo.png&type=input')).toBe('sub/logo.png')
  })
  it('defaults missing type to input', () => {
    expect(inputNameFromViewUrl('/view?filename=a.png')).toBe('a.png')
  })
  it('rejects non-input views and external URLs', () => {
    expect(inputNameFromViewUrl('/view?filename=a.png&type=output')).toBeNull()
    expect(inputNameFromViewUrl('https://example.com/logo.png')).toBeNull()
    expect(inputNameFromViewUrl('')).toBeNull()
  })
})
