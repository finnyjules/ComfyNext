import { describe, expect, it } from 'vitest'
import { describeQueueRefusal } from '../../app/lib/queueRefusal'

describe('describeQueueRefusal', () => {
  it('moderation refusal → title + content-policy pointer', () => {
    const d = describeQueueRefusal({ refusal: true, statusCode: 400, message: 'This prompt was blocked by content moderation' })
    expect(d).toEqual({ title: 'This prompt was blocked by content moderation', description: 'See our content policy for what’s allowed.', policyLink: true })
  })
  it('credits refusal → plain message, no policy link', () => {
    const d = describeQueueRefusal({ refusal: true, statusCode: 402, message: 'insufficient credits' })
    expect(d).toEqual({ title: 'insufficient credits', description: undefined, policyLink: false })
  })
  it('paused / ownership refusals pass their server message through', () => {
    expect(describeQueueRefusal({ refusal: true, statusCode: 503, message: 'Sailor is temporarily paused' })!.title).toBe('Sailor is temporarily paused')
    expect(describeQueueRefusal({ refusal: true, statusCode: 403, message: 'graph references an input file you do not own (LoadImage.image)' })!.title).toContain('do not own')
  })
  it('non-refusal queue errors (ComfyUI validation) → null (existing node-mark path handles them)', () => {
    expect(describeQueueRefusal({ message: 'The workflow failed validation.', node_errors: { '5': {} } })).toBeNull()
    expect(describeQueueRefusal({})).toBeNull()
  })
  it('400 refusal that is NOT moderation (e.g. missing prompt graph) → plain message, no policy link', () => {
    const d = describeQueueRefusal({ refusal: true, statusCode: 400, message: 'Missing prompt graph' })
    expect(d).toEqual({ title: 'Missing prompt graph', description: undefined, policyLink: false })
  })
})
