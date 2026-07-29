import { describe, it, expect } from 'vitest'
import { imageUrlForNode } from '~/lib/canvas/nodeImage'

const node = (type: string, data: any) => ({ type, data })

describe('imageUrlForNode', () => {
  it('prefers a rendered execution output', () => {
    expect(imageUrlForNode(node('artifact-image', { images: ['/view?filename=out.png&type=output'] })))
      .toBe('/view?filename=out.png&type=output')
  })

  it('falls back to the image widget, resolved by NAME not position', () => {
    // widgetsValues is positional; the image widget is not always index 0.
    const n = node('artifact-image', {
      widgetDefs: [{ name: 'seed' }, { name: 'image' }],
      widgetsValues: [12345, 'photo.png'],
    })
    expect(imageUrlForNode(n)).toBe('/view?filename=photo.png&type=input')
  })

  it('falls back to index 0 when there are no widgetDefs to name-match', () => {
    expect(imageUrlForNode(node('artifact-image', { widgetsValues: ['solo.png'] })))
      .toBe('/view?filename=solo.png&type=input')
  })

  it('encodes filenames with spaces and symbols', () => {
    const url = imageUrlForNode(node('artifact-image', { widgetsValues: ['my shot (1).png'] }))
    expect(url).not.toContain(' ')
    expect(url).toContain('filename=my+shot+%281%29.png')
  })

  it('returns null for an artifact-image with nothing rendered or uploaded', () => {
    expect(imageUrlForNode(node('artifact-image', {}))).toBeNull()
    expect(imageUrlForNode(node('artifact-image', { images: [] }))).toBeNull()
    expect(imageUrlForNode(node('artifact-image', { widgetsValues: [''] }))).toBeNull()
  })

  it('returns null for node types that carry no image', () => {
    expect(imageUrlForNode(node('artifact-text', { widgetsValues: ['hello'] }))).toBeNull()
    expect(imageUrlForNode(node('comfy', { images: ['/view?filename=x.png'] }))).toBeNull()
  })

  it('tolerates malformed nodes rather than throwing', () => {
    expect(imageUrlForNode(null)).toBeNull()
    expect(imageUrlForNode(undefined)).toBeNull()
    expect(imageUrlForNode({} as any)).toBeNull()
    expect(imageUrlForNode(node('artifact-image', null))).toBeNull()
  })
})
