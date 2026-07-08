import { describe, it, expect, vi } from 'vitest'
import { planTempImagePromotion, promoteTempImageInputs, annotatedImageValueFromViewUrl } from '~/lib/promoteTempImages'

// A standalone `Image` artifact wired downstream gets its `image` widget
// backfilled with the shown result's annotated path. For a `temp` preview that
// path is `name [temp]`, which dies when ComfyUI wipes temp/ on restart. These
// helpers re-upload such temp images into the durable input dir before submit.

function imageNode(id: number, widgets: any[]) {
  return { id, type: 'Image', widgets_values: widgets }
}

describe('planTempImagePromotion', () => {
  it('finds a temp-annotated image widget and reconstructs its /view URL', () => {
    const wf = { nodes: [imageNode(5, ['Image_preview_vziej_00001_.png [temp]', true])] }
    const refs = planTempImagePromotion(wf)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      nodeIndex: 0,
      widgetIndex: 0,
      filename: 'Image_preview_vziej_00001_.png',
      subfolder: '',
      viewUrl: '/view?filename=Image_preview_vziej_00001_.png&type=temp',
    })
  })

  it('parses a subfolder annotation into the view URL', () => {
    const wf = { nodes: [imageNode(1, ['clipspace/x.png [temp]'])] }
    const refs = planTempImagePromotion(wf)
    expect(refs[0]!.filename).toBe('x.png')
    expect(refs[0]!.subfolder).toBe('clipspace')
    expect(refs[0]!.viewUrl).toBe('/view?filename=x.png&type=temp&subfolder=clipspace')
  })

  it('ignores non-Image nodes, output/input refs, and non-string widget values', () => {
    const wf = {
      nodes: [
        { id: 1, type: 'LoadImage', widgets_values: ['a.png [temp]'] }, // not an Image artifact node
        imageNode(2, ['durable.png [output]']),                          // output persists — leave it
        imageNode(3, ['plain_input.png']),                               // bare input — already durable
        imageNode(4, [42, null, true]),                                  // non-string values
      ],
    }
    expect(planTempImagePromotion(wf)).toHaveLength(0)
  })

  it('returns [] for a malformed workflow', () => {
    expect(planTempImagePromotion({} as any)).toEqual([])
    expect(planTempImagePromotion({ nodes: null } as any)).toEqual([])
  })
})

describe('promoteTempImageInputs', () => {
  it('no temp refs → no-op, deps never called', async () => {
    const fetchFn = vi.fn()
    const uploadFn = vi.fn()
    const wf = { nodes: [imageNode(1, ['durable.png'])] }
    const out = await promoteTempImageInputs(wf, { fetchFn, uploadFn })
    expect(out).toEqual({ promoted: 0, missing: [] })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(uploadFn).not.toHaveBeenCalled()
  })

  it('promotes a temp ref: fetch → upload → rewrite widget to the bare input name', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }))
    const uploadFn = vi.fn(async (_blob: Blob, filename: string) => filename) // input keeps the name
    const wf = { nodes: [imageNode(7, ['pic_00001_.png [temp]', true])] }

    const out = await promoteTempImageInputs(wf, { fetchFn, uploadFn })

    expect(fetchFn).toHaveBeenCalledWith('/view?filename=pic_00001_.png&type=temp')
    expect(uploadFn).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ promoted: 1, missing: [] })
    // widget rewritten to a durable (bare = input dir) reference, annotation gone
    expect(wf.nodes[0]!.widgets_values[0]).toBe('pic_00001_.png')
  })

  it('surfaces an upload failure as a distinct error (not "expired")', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }))
    const uploadFn = vi.fn(async () => { throw new Error('upload 500') })
    const wf = { nodes: [imageNode(7, ['pic_00001_.png [temp]'])] }
    const p = promoteTempImageInputs(wf, { fetchFn, uploadFn })
    await expect(p).rejects.toThrow(/input folder/)
    await expect(p).rejects.not.toThrow(/expired/)
  })

  it('skips a malformed bare " [temp]" annotation (no filename)', () => {
    const refs = planTempImagePromotion({ nodes: [imageNode(1, [' [temp]'])] })
    expect(refs).toEqual([])
  })

  it('throws a clear error when the temp file is already gone (fetch not ok)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, blob: async () => new Blob() }))
    const uploadFn = vi.fn()
    const wf = { nodes: [imageNode(7, ['gone_00001_.png [temp]'])] }

    await expect(promoteTempImageInputs(wf, { fetchFn, uploadFn })).rejects.toThrow(/gone_00001_\.png/)
    expect(uploadFn).not.toHaveBeenCalled()
    // widget left untouched (so nothing half-promoted is submitted)
    expect(wf.nodes[0]!.widgets_values[0]).toBe('gone_00001_.png [temp]')
  })
})

describe('annotatedImageValueFromViewUrl', () => {
  it('rebuilds an annotated output-dir reference from a take /view URL', () => {
    const url = '/view?filename=Image_00007_.png&type=output&subfolder=&t=1720000000000'
    expect(annotatedImageValueFromViewUrl(url)).toBe('Image_00007_.png [output]')
  })

  it('includes the subfolder when present', () => {
    const url = '/view?filename=x.png&type=output&subfolder=clipspace&t=1'
    expect(annotatedImageValueFromViewUrl(url)).toBe('clipspace/x.png [output]')
  })

  it('works for a temp-type take (live-preview result branched before it clears)', () => {
    const url = '/view?filename=preview.png&type=temp'
    expect(annotatedImageValueFromViewUrl(url)).toBe('preview.png [temp]')
  })

  it('resolves a worker-absolute URL (parallel-pool takes) the same way', () => {
    const url = 'http://127.0.0.1:8189/view?filename=y.png&type=output'
    expect(annotatedImageValueFromViewUrl(url)).toBe('y.png [output]')
  })

  it('returns null for a data: URL or anything without filename+type', () => {
    expect(annotatedImageValueFromViewUrl('data:image/png;base64,AAA')).toBeNull()
    expect(annotatedImageValueFromViewUrl('/view?filename=x.png')).toBeNull()
    expect(annotatedImageValueFromViewUrl(undefined)).toBeNull()
    expect(annotatedImageValueFromViewUrl(null)).toBeNull()
    expect(annotatedImageValueFromViewUrl('')).toBeNull()
  })
})
