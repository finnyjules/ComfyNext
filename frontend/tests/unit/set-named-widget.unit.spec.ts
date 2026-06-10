import { describe, it, expect } from 'vitest'
import { setNamedWidget, getNamedWidget } from '../../app/composables/useFilteredPrompt'
import type { LiteGraphNode } from '../../app/composables/useVueNodes'

// Minimal /object_info fixture for a Timeline-like node. Widget order in
// widgets_values follows declared input order (required, then optional),
// skipping ports (VIDEO) and forceInput widgets — so:
//   [0] fps, [1] quality (combo), [2] edit_state
const objectInfo = {
  Timeline: {
    input: {
      required: {
        video: ['VIDEO'],                                  // port — no widgets_values slot
        fps: ['INT', { default: 30 }],
        quality: [['draft', 'final']],                     // legacy combo
      },
      optional: {
        forced: ['STRING', { forceInput: true }],          // forced port — no slot
        edit_state: ['STRING', { default: '' }],
      },
    },
  },
}

// objectInfo as a stale browser cache would have it: edit_state was added by a
// later ComfyUI restart and is missing here.
const staleObjectInfo = {
  Timeline: {
    input: {
      required: {
        video: ['VIDEO'],
        fps: ['INT', { default: 30 }],
        quality: [['draft', 'final']],
      },
      optional: {},
    },
  },
}

function timelineNode(): LiteGraphNode {
  return { id: 1, type: 'Timeline', widgets_values: [30, 'draft'] } as unknown as LiteGraphNode
}

describe('setNamedWidget', () => {
  it('returns true and writes at the right positional index for a known widget', () => {
    const n = timelineNode()
    const ok = setNamedWidget(n, 'edit_state', '{"tracks":[]}', objectInfo)
    expect(ok).toBe(true)
    // ports/forceInput don't occupy slots: fps=0, quality=1, edit_state=2
    expect(n.widgets_values).toEqual([30, 'draft', '{"tracks":[]}'])
    expect(getNamedWidget(n, 'edit_state', objectInfo)).toBe('{"tracks":[]}')
  })

  it('pads widgets_values with nulls when writing past the current length', () => {
    const n = { id: 2, type: 'Timeline', widgets_values: [] } as unknown as LiteGraphNode
    expect(setNamedWidget(n, 'edit_state', 'x', objectInfo)).toBe(true)
    expect(n.widgets_values).toEqual([null, null, 'x'])
  })

  it('returns false (and writes nothing) when the widget is missing from the cached schema', () => {
    // The stale-schema bug: a cached objectInfo predating a ComfyUI restart
    // lacks edit_state — this must be detectable, not a silent no-op.
    const n = timelineNode()
    const ok = setNamedWidget(n, 'edit_state', '{"tracks":[]}', staleObjectInfo)
    expect(ok).toBe(false)
    expect(n.widgets_values).toEqual([30, 'draft'])
  })

  it('returns false when the node type itself is unknown', () => {
    const n = { id: 3, type: 'NotARealNode', widgets_values: [] } as unknown as LiteGraphNode
    expect(setNamedWidget(n, 'anything', 1, objectInfo)).toBe(false)
  })
})
