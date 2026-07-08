import { describe, it, expect } from 'vitest'
import { isWidgetInput, widgetSlots, UnknownNodeTypeError } from '~/lib/graph/widgetOrder'

describe('isWidgetInput', () => {
  it('treats combo (array-typed) specs as widget inputs', () => {
    expect(isWidgetInput([['euler', 'dpmpp_2m']])).toBe(true)
  })
  it('treats INT/FLOAT/STRING/BOOLEAN as widget inputs', () => {
    expect(isWidgetInput(['INT', {}])).toBe(true)
    expect(isWidgetInput(['FLOAT', {}])).toBe(true)
    expect(isWidgetInput(['STRING', {}])).toBe(true)
    expect(isWidgetInput(['BOOLEAN', {}])).toBe(true)
  })
  it('treats opts.widget hint as a widget input', () => {
    expect(isWidgetInput(['CUSTOMTYPE', { widget: true }])).toBe(true)
  })
  it('treats connection-only types as non-widget inputs', () => {
    expect(isWidgetInput(['IMAGE', {}])).toBe(false)
    expect(isWidgetInput(['MODEL', {}])).toBe(false)
    expect(isWidgetInput(['CONDITIONING', {}])).toBe(false)
  })
  it('excludes forceInput specs even if otherwise widget-shaped', () => {
    expect(isWidgetInput(['INT', { forceInput: true }])).toBe(false)
    expect(isWidgetInput([['a', 'b'], { forceInput: true }])).toBe(false)
  })
})

describe('widgetSlots', () => {
  it('derives KSampler-like order with a control_after_generate slot after seed', () => {
    const objectInfo = {
      KSampler: {
        input: {
          required: {
            model: ['MODEL', {}],
            positive: ['CONDITIONING', {}],
            seed: ['INT', { control_after_generate: true }],
            steps: ['INT', {}],
            cfg: ['FLOAT', {}],
            sampler_name: [['euler', 'dpmpp_2m'], {}],
          },
        },
      },
    }
    expect(widgetSlots('KSampler', objectInfo)).toEqual([
      { name: 'seed' },
      { name: 'seed__control', control: true },
      { name: 'steps' },
      { name: 'cfg' },
      { name: 'sampler_name' },
    ])
  })

  it('excludes forceInput: true INT inputs from the slot order', () => {
    const objectInfo = {
      SomeNode: {
        input: {
          required: {
            amount: ['INT', { forceInput: true }],
            label: ['STRING', {}],
          },
        },
      },
    }
    expect(widgetSlots('SomeNode', objectInfo)).toEqual([{ name: 'label' }])
  })

  it('orders optional inputs after required inputs', () => {
    const objectInfo = {
      SomeNode: {
        input: {
          required: {
            steps: ['INT', {}],
          },
          optional: {
            cfg: ['FLOAT', {}],
          },
        },
      },
    }
    expect(widgetSlots('SomeNode', objectInfo)).toEqual([{ name: 'steps' }, { name: 'cfg' }])
  })

  it('throws UnknownNodeTypeError for a classType absent from object_info', () => {
    expect(() => widgetSlots('DoesNotExist', {})).toThrow(UnknownNodeTypeError)
  })
})
