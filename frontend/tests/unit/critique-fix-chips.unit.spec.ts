import { describe, it, expect } from 'vitest'
import { paidProducerFor } from '~/lib/artifact/nextSteps'
import { parseReviewResponse } from '~/lib/agent/protocol'

describe('paidProducerFor', () => {
  const paid = { id: 'g1', data: { priceBadge: { expr: '0.03' } } }
  const free = { id: 'g2', data: {} }
  const artifact = { id: 'a1', data: {} }
  it('true when a direct upstream source carries a price badge', () => {
    expect(paidProducerFor('a1', [paid, artifact], [{ source: 'g1', target: 'a1' }])).toBe(true)
  })
  it('false for a free producer', () => {
    expect(paidProducerFor('a1', [free, artifact], [{ source: 'g2', target: 'a1' }])).toBe(false)
  })
  it('false with no upstream at all (uploaded image)', () => {
    expect(paidProducerFor('a1', [artifact], [])).toBe(false)
  })
  it('true when ANY of several inputs is paid', () => {
    expect(paidProducerFor('a1', [paid, free, artifact], [
      { source: 'g2', target: 'a1' }, { source: 'g1', target: 'a1' },
    ])).toBe(true)
  })
})

describe('parseReviewResponse fixLabels', () => {
  it('extracts a label per fix, aligned with fixes', () => {
    const res = parseReviewResponse(JSON.stringify({
      assessment: 'has defects',
      issues: ['left hand is malformed'],
      fixes: [{ op: 'addNode', args: '{}', rationale: 'repair anatomy', label: 'Fix hands' }],
    }))
    expect(res.fixes).toHaveLength(1)
    expect(res.fixLabels).toEqual(['Fix hands'])
  })
  it('missing label yields empty string (caller falls back to rationale)', () => {
    const res = parseReviewResponse(JSON.stringify({
      assessment: '', issues: [], fixes: [{ op: 'setWidget', args: '{}' }],
    }))
    expect(res.fixLabels).toEqual([''])
  })
})
