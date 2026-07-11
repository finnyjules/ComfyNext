import { describe, expect, it } from 'vitest'
import { templateToSatori } from '~~/server/templates/translate'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const T: TemplateV2 = {
  version: 2, id: 't', name: 't', master: '1x1',
  formats: { '1x1': { w: 1080, h: 1080 }, '728x90': { w: 728, h: 90 } },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  background: { fill: '#101418' },
  elements: [
    { id: 'headline', type: 'text', content: '{{ props.text_layer_1 }}', level: 'display', priority: 1,
      region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 },
      style: { color: '#ffffff', valign: 'bottom' } },
    { id: 'subhead', type: 'text', content: 'Espresso monthly', level: 'subhead', priority: 5,
      region: { col: 1, colSpan: 4, row: 6, rowSpan: 1 } },
    { id: 'hero', type: 'image', content: 'http://x/img.png', priority: 4,
      region: { col: 4, colSpan: 3, row: 1, rowSpan: 3 }, focal: { x: 0.3, y: 0.7 } },
  ],
}

function flatten(node: any, out: any[] = []): any[] {
  out.push(node)
  const kids = node?.props?.children
  if (Array.isArray(kids)) kids.forEach((k: any) => typeof k === 'object' && flatten(k, out))
  else if (kids && typeof kids === 'object') flatten(kids, out)
  return out
}

describe('templateToSatori (v2)', () => {
  it('renders at the format size with absolute-positioned children', () => {
    const { width, height, tree } = templateToSatori(T as any, '1x1', { text_layer_1: 'Brew bold' })
    expect(width).toBe(1080)
    expect(height).toBe(1080)
    const nodes = flatten(tree)
    const text = nodes.find(n => n?.props?.children === 'Brew bold')
    expect(text).toBeTruthy()
    expect(text.props.style.position).toBe('absolute')
    expect(text.props.style.justifyContent).toBe('flex-end')   // valign: bottom
    expect(Number.parseFloat(text.props.style.fontSize)).toBeGreaterThan(50)
  })
  it('passes focal point through as objectPosition', () => {
    const { tree } = templateToSatori(T as any, '1x1', {})
    const img = flatten(tree).find(n => n?.type === 'img' && n.props.src === 'http://x/img.png')
    expect(img.props.style.objectPosition).toBe('30% 70%')
  })
  it('drops culled elements (subhead on strips)', () => {
    const { width, tree } = templateToSatori(T as any, '728x90', { text_layer_1: 'Brew bold' })
    expect(width).toBe(728)
    const texts = flatten(tree).filter(n => typeof n?.props?.children === 'string')
    expect(texts.some(n => n.props.children === 'Espresso monthly')).toBe(false)
    expect(texts.some(n => n.props.children === 'Brew bold')).toBe(true)
  })
  it('still renders v1 templates through the legacy path', () => {
    const v1 = {
      version: 1, id: 'v1', name: 'v1',
      aspects: { '1x1': { w: 512, h: 512 } }, defaultAspect: '1x1',
      elements: [{ id: 't', type: 'text', anchor: 'center', offset: { x: 0, y: 0 },
        size: { w: '80%', h: 'auto' }, style: { fontSize: 64 }, content: 'legacy' }],
    }
    const { width } = templateToSatori(v1 as any, '1x1', {})
    expect(width).toBe(512)
  })

  it('resolves brand tokens from the template-default brand kit', () => {
    const branded: any = {
      ...T,
      brand: { primary: '#E2362B', fontDisplay: 'Bebas Neue' },
      elements: [
        { id: 'h', type: 'text', content: 'Hi', level: 'display', priority: 1,
          region: { col: 1, colSpan: 6, row: 1, rowSpan: 2 },
          style: { color: '{{ brand.primary }}', fontFamily: '{{ brand.fontDisplay }}' } },
      ],
    }
    const text = flatten(templateToSatori(branded, '1x1', {}).tree)
      .find(n => n?.props?.children === 'Hi')
    expect(text.props.style.color).toBe('#E2362B')
    expect(text.props.style.fontFamily).toBe('Bebas Neue')
  })

  it('renders an unwired image as a placeholder, not a broken <img> src', () => {
    const t: any = {
      ...T,
      elements: [
        { id: 'hero', type: 'image', content: '{{ props.image_layer_1 }}', priority: 4,
          region: { col: 1, colSpan: 6, row: 1, rowSpan: 6 } },
      ],
    }
    // No props.image_layer_1 → must not emit an <img> with the literal token.
    const nodes = flatten(templateToSatori(t, '1x1', {}).tree)
    const brokenImg = nodes.find(n => n?.type === 'img' && String(n.props.src).includes('{{'))
    expect(brokenImg).toBeUndefined()
  })

  it('centres strip text vertically by default, keeps top elsewhere', () => {
    const t: any = {
      ...T,
      elements: [
        { id: 'h', type: 'text', content: 'Hi', level: 'headline', priority: 1,
          region: { col: 1, colSpan: 6, row: 1, rowSpan: 1 }, style: { color: '#fff' } },
      ],
    }
    const strip = flatten(templateToSatori(t, '728x90', {}).tree).find(n => n?.props?.children === 'Hi')
    expect(strip.props.style.justifyContent).toBe('center')   // strip → middle
    const square = flatten(templateToSatori(t, '1x1', {}).tree).find(n => n?.props?.children === 'Hi')
    expect(square.props.style.justifyContent).toBe('flex-start')  // square → top
  })

  it('draws a text scrim/panel as a semi-transparent container background', () => {
    const t: any = {
      ...T,
      brand: { primary: '#E2362B' },
      elements: [
        { id: 'h', type: 'text', content: 'Hi', level: 'display', priority: 1,
          region: { col: 1, colSpan: 6, row: 1, rowSpan: 2 },
          style: { color: '#fff', panel: { fill: '{{ brand.primary }}', opacity: 0.6, radius: 8 } } },
      ],
    }
    const text = flatten(templateToSatori(t, '1x1', {}).tree).find(n => n?.props?.children === 'Hi')
    expect(text.props.style.background).toBe('rgba(226, 54, 43, 0.6)')
    expect(text.props.style.borderRadius).toBe(8)
  })

  it('does not stretch line-height into expressive word placement on vertical justify', () => {
    // The expressive engine distributes word `top`s across the box height
    // itself — the container's CSS line-height must stay at the element's own
    // value (editor parity). The justify-stretched line-height (rect.h /
    // numLines) is for the plain-text path only; leaking it here inflates
    // every word's line box, shifting glyphs down and cropping the last line.
    const t: any = {
      ...T,
      elements: [
        { id: 'h', type: 'text', content: 'A new kind of skincare is coming', level: 'body', priority: 1,
          region: { col: 2, colSpan: 14, row: 2, rowSpan: 14 },
          style: { color: '#fff', valign: 'justify', fontSize: 100,
            expressive: { wordsPerLine: 1, placement: 'random', jitterX: 1, jitterY: 0, seed: 4 } } },
      ],
    }
    const nodes = flatten(templateToSatori(t, '1x1', {}).tree)
    const container = nodes.find(n => Array.isArray(n?.props?.children)
      && n.props.children.some((c: any) => c?.props?.children === 'coming'))
    expect(container).toBeTruthy()
    expect(container.props.style.lineHeight).toBe(1.1)
    // Every word's line box must fit inside the element box.
    const lineBox = 100 * 1.1
    for (const w of container.props.children) {
      const top = Number.parseFloat(w.props.style.top)
      expect(top + lineBox).toBeLessThanOrEqual(Number.parseFloat(container.props.style.height) + 0.5)
    }
  })

  it('applies manual word nudges in the export (editor parity, no translate code)', () => {
    const mk = (nudges?: Record<number, { dx: number; dy: number }>): any => ({
      ...T,
      elements: [
        { id: 'h', type: 'text', content: 'alpha beta', level: 'body', priority: 1,
          region: { col: 2, colSpan: 14, row: 2, rowSpan: 14 },
          style: { color: '#fff', fontSize: 100,
            expressive: { wordsPerLine: 1, placement: 'random', jitterX: 0, jitterY: 0, seed: 1,
              ...(nudges ? { nudges } : {}) } } },
      ],
    })
    const px = (v: unknown) => Number.parseFloat(String(v))
    const wordNode = (tree: any, text: string) => flatten(tree).find(n => n?.props?.children === text)
    const container = flatten(templateToSatori(mk(), '1x1', {}).tree)
      .find(n => Array.isArray(n?.props?.children) && n.props.children.some((c: any) => c?.props?.children === 'beta'))
    const boxW = px(container.props.style.width)
    const boxH = px(container.props.style.height)

    const before = wordNode(templateToSatori(mk(), '1x1', {}).tree, 'beta')
    const after = wordNode(templateToSatori(mk({ 1: { dx: 0.1, dy: 0.1 } }), '1x1', {}).tree, 'beta')
    expect(px(after.props.style.left)).toBeCloseTo(px(before.props.style.left) + 0.1 * boxW, 1)
    expect(px(after.props.style.top)).toBeCloseTo(px(before.props.style.top) + 0.1 * boxH, 1)
  })

  it('lets a wired brand socket override the template brand', () => {
    const branded: any = {
      ...T,
      brand: { primary: '#E2362B' },
      elements: [
        { id: 'h', type: 'text', content: 'Hi', level: 'display', priority: 1,
          region: { col: 1, colSpan: 6, row: 1, rowSpan: 2 },
          style: { color: '{{ brand.primary }}' } },
      ],
    }
    const text = flatten(templateToSatori(branded, '1x1', {}, { primary: '#00A3FF' }).tree)
      .find(n => n?.props?.children === 'Hi')
    expect(text.props.style.color).toBe('#00A3FF')
  })
})

describe('templateToSatori (v3 sections)', () => {
  const V3: any = {
    version: 3, id: 't3', name: 't3', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 }, '9x16': { w: 1080, h: 1920 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    background: { fill: '#101418' },
    brand: { primary: '#E2362B', fontDisplay: 'Bebas Neue' },
    elements: [],
    sections: [
      {
        id: 'lockup', name: 'headline lockup',
        region: { col: 1, colSpan: 40, row: 1, rowSpan: 40 },
        children: [
          { id: 'headline', type: 'text', content: '{{ props.text_layer_1 }}', level: 'display', priority: 1,
            region: { col: 1, colSpan: 40, row: 1, rowSpan: 10 },
            style: { color: '{{ brand.primary }}', fontFamily: '{{ brand.fontDisplay }}' } },
        ],
      },
    ],
  }

  it('routes v3 through the grid path and renders section children', () => {
    const { width, tree } = templateToSatori(V3, '1x1', { text_layer_1: 'Brew bold' })
    expect(width).toBe(1080)
    const text = flatten(tree).find(n => n?.props?.children === 'Brew bold')
    expect(text).toBeTruthy()
    expect(text.props.style.position).toBe('absolute')
    expect(text.props.style.color).toBe('#E2362B')        // brand token on a child
    expect(text.props.style.fontFamily).toBe('Bebas Neue')
  })

  it('adapts the section across formats (child still present in portrait)', () => {
    const text = flatten(templateToSatori(V3, '9x16', { text_layer_1: 'Brew bold' }).tree)
      .find(n => n?.props?.children === 'Brew bold')
    expect(text).toBeTruthy()
  })
})
