import { describe, it, expect } from 'vitest'
import { mediaFilenameFromValue, collectProjectMediaFilenames } from '../../app/lib/timeline/projectMedia'

describe('mediaFilenameFromValue', () => {
  it('accepts plain media filenames and annotated widget values', () => {
    expect(mediaFilenameFromValue('clip.mp4')).toBe('clip.mp4')
    expect(mediaFilenameFromValue('shot.png [input]')).toBe('shot.png')
    expect(mediaFilenameFromValue('sub/dir/tone.wav')).toBe('tone.wav')
  })
  it('extracts the filename param from view URLs', () => {
    expect(mediaFilenameFromValue('/view?filename=out.mp4&type=output')).toBe('out.mp4')
    expect(mediaFilenameFromValue('/view?filename=a.png&subfolder=x&type=temp&r=123')).toBe('a.png')
  })
  it('rejects non-media strings', () => {
    expect(mediaFilenameFromValue('hello world')).toBeNull()
    expect(mediaFilenameFromValue('KINETIC')).toBeNull()
    expect(mediaFilenameFromValue('https://example.com/page')).toBeNull()
    expect(mediaFilenameFromValue('{"json":"blob.mp4extra"}')).toBeNull()
    expect(mediaFilenameFromValue(42 as any)).toBeNull()
  })
})

describe('collectProjectMediaFilenames', () => {
  it('walks every canvas workflow plus live nodes (takes included)', () => {
    const doc = {
      canvases: [
        { workflow: { nodes: [{ widgets_values: ['a.mp4', 3, 'seed'] }] } },
        { workflow: { nodes: [{ properties: { sailor_preview: { images: ['/view?filename=b.png&type=temp'] } } }] } },
      ],
    }
    const live = [
      { data: { widgetsValues: ['c.wav [input]'], takes: [{ videos: ['/view?filename=d.webm&type=output'] }] } },
    ]
    const got = collectProjectMediaFilenames(doc, live)
    expect([...got].sort()).toEqual(['a.mp4', 'b.png', 'c.wav', 'd.webm'])
  })
  it('empty project → empty set', () => {
    expect(collectProjectMediaFilenames(null, []).size).toBe(0)
  })
})
