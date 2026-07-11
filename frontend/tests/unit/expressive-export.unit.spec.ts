import { describe, expect, it } from 'vitest'
import { templateToSatori } from '~~/server/templates/translate'
import type { TemplateV3 } from '~~/shared/template-grid/types'

function tpl(expressive: unknown): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [{
      id: 'tx', type: 'text', priority: 1,
      content: 'alpha beta gamma delta',
      level: 'headline',
      region: { col: 4, colSpan: 40, row: 4, rowSpan: 20 },
      style: { align: 'left', ...(expressive ? { expressive } : {}) } as any,
    }],
    sections: [],
  }
}

// Flatten the satori tree into a list of nodes.
function walk(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  out.push(node)
  const kids = node.props?.children
  if (Array.isArray(kids)) for (const k of kids) walk(k, out)
  else if (kids && typeof kids === 'object') walk(kids, out)
  return out
}

describe('expressive text — Satori export', () => {
  it('emits one absolutely-positioned box per word', () => {
    const { tree } = templateToSatori(tpl({ wordsPerLine: 1, placement: 'edges', jitterX: 0, jitterY: 0, seed: 1 }), '1x1')
    const nodes = walk(tree)
    const wordBoxes = nodes.filter(n => n.props?.style?.position === 'absolute' && n.props?.style?.whiteSpace === 'nowrap' && typeof n.props?.children === 'string')
    const texts = wordBoxes.map(n => n.props.children)
    expect(texts).toEqual(['alpha', 'beta', 'gamma', 'delta'])
    // Every word box carries an explicit left/top offset.
    for (const b of wordBoxes) {
      expect(b.props.style.left).toMatch(/px$/)
      expect(b.props.style.top).toMatch(/px$/)
    }
  })

  it('without expressive, text stays a single flow node (no per-word boxes)', () => {
    const { tree } = templateToSatori(tpl(null), '1x1')
    const nodes = walk(tree)
    const wordBoxes = nodes.filter(n => n.props?.style?.position === 'absolute' && n.props?.style?.whiteSpace === 'nowrap' && typeof n.props?.children === 'string')
    expect(wordBoxes).toHaveLength(0)
    // The whole string is present as one child somewhere in the tree.
    const flow = nodes.find(n => n.props?.children === 'alpha beta gamma delta')
    expect(flow).toBeTruthy()
  })
})
