import { describe, it, expect } from 'vitest'
import { parseViewUrl, extractCoverImages, buildPreviewImages } from '~/lib/projectCover'

const view = (filename: string, type = 'input', subfolder = '') => {
  const p = new URLSearchParams({ filename, type })
  if (subfolder) p.set('subfolder', subfolder)
  return `/view?${p}`
}

function doc(nodes: any[], extraCanvases: any[] = []) {
  return { canvases: [{ id: 'c1', name: 'Canvas', workflow: { nodes } }, ...extraCanvases], activeCanvasId: 'c1' }
}

describe('parseViewUrl', () => {
  it('parses a /view URL into filename/subfolder/type parts', () => {
    expect(parseViewUrl(view('frame_1.png', 'input', 'sub'))).toEqual({
      kind: 'image', filename: 'frame_1.png', subfolder: 'sub', type: 'input',
    })
  })
  it('defaults subfolder to empty and classifies kind from the extension', () => {
    expect(parseViewUrl(view('clip.mp4', 'output'))).toEqual({
      kind: 'video', filename: 'clip.mp4', subfolder: '', type: 'output',
    })
  })
  it('rejects data URLs, non-view URLs, and URLs without filename', () => {
    expect(parseViewUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(parseViewUrl('https://example.com/x.png')).toBeNull()
    expect(parseViewUrl('/view?type=input')).toBeNull()
  })
})

describe('buildPreviewImages', () => {
  const img = (filename: string, subfolder = ''): any => ({ kind: 'image', filename, subfolder, type: 'input' })
  it('fills from sources in order, dedups by subfolder/filename, caps at 3', () => {
    const out = buildPreviewImages([
      [img('a.png'), img('b.png')],
      [img('a.png'), img('c.png'), img('d.png')],
    ])
    expect(out.map((o) => o.filename)).toEqual(['a.png', 'b.png', 'c.png'])
  })
  it('treats same filename in different subfolders as distinct', () => {
    const out = buildPreviewImages([[img('a.png'), img('a.png', 'sub')]])
    expect(out).toHaveLength(2)
  })
})

describe('extractCoverImages', () => {
  it('collects Frame composites first, then Scene3D bakes, then other node previews', () => {
    const d = doc([
      { type: 'Image', properties: { sailor_preview: { images: [view('gen_out.png', 'output')] } } },
      { type: 'Scene3DStudio', widgets_values: ['{}', 'scene3d_beauty_7_abc.png', 'scene3d_depth_7_abc.png'] },
      { type: 'Compositor', properties: { sailor_preview: { images: [view('frame_comp.png')] } } },
    ])
    expect(extractCoverImages(d).map((o) => o.filename)).toEqual([
      'frame_comp.png', 'scene3d_beauty_7_abc.png', 'gen_out.png',
    ])
  })
  it('reads Scene3D bakes as input-type images', () => {
    const d = doc([{ type: 'Scene3DStudio', widgets_values: ['scene3d_beauty_2_x.png'] }])
    expect(extractCoverImages(d)).toEqual([
      { kind: 'image', filename: 'scene3d_beauty_2_x.png', subfolder: '', type: 'input' },
    ])
  })
  it('skips data URLs, videos, and nodes without previews; dedups across nodes; caps at 3', () => {
    const d = doc([
      { type: 'Compositor', properties: { sailor_preview: { images: ['data:image/png;base64,AA', view('a.png'), view('v.mp4')] } } },
      { type: 'Image', properties: { sailor_preview: { images: [view('a.png'), view('b.png'), view('c.png'), view('d.png')] } } },
      { type: 'KSampler' },
    ])
    expect(extractCoverImages(d).map((o) => o.filename)).toEqual(['a.png', 'b.png', 'c.png'])
  })
  it('walks every canvas in the doc', () => {
    const d = doc(
      [{ type: 'Compositor', properties: { sailor_preview: { images: [view('one.png')] } } }],
      [{ id: 'c2', name: 'B', workflow: { nodes: [{ type: 'Compositor', properties: { sailor_preview: { images: [view('two.png')] } } }] } }],
    )
    expect(extractCoverImages(d).map((o) => o.filename)).toEqual(['one.png', 'two.png'])
  })
  it('tolerates a legacy bare-workflow doc and garbage input', () => {
    expect(extractCoverImages({ nodes: [{ type: 'Compositor', properties: { sailor_preview: { images: [view('x.png')] } } }] })
      .map((o) => o.filename)).toEqual(['x.png'])
    expect(extractCoverImages(null)).toEqual([])
    expect(extractCoverImages({})).toEqual([])
  })
})
