import { describe, expect, it } from 'vitest'
import { inlineTreeImages } from '~~/server/templates/inlineImages'

const img = (src: string) => ({ type: 'img', props: { src } })
const div = (...children: any[]) => ({ type: 'div', props: { children } })

const okFetcher = async (url: string) => ({
  data: new TextEncoder().encode(`bytes-of-${url}`).buffer as ArrayBuffer,
  contentType: 'image/png',
})

describe('inlineTreeImages', () => {
  it('replaces http(s) srcs with data URIs, deep in the tree', async () => {
    const a = img('http://x/a.png')
    const b = img('https://y/b.png')
    const tree = div(div(a), b)
    await inlineTreeImages(tree, okFetcher)
    expect(a.props.src).toMatch(/^data:image\/png;base64,/)
    expect(b.props.src).toMatch(/^data:image\/png;base64,/)
  })

  it('fetches duplicate URLs once and leaves data:/other schemes untouched', async () => {
    let calls = 0
    const counting = async (url: string) => { calls++; return okFetcher(url) }
    const a = img('http://x/same.png')
    const b = img('http://x/same.png')
    const c = img('data:image/png;base64,AAA')
    await inlineTreeImages(div(a, b, c), counting)
    expect(calls).toBe(1)
    expect(a.props.src).toBe(b.props.src)
    expect(c.props.src).toBe('data:image/png;base64,AAA')
  })

  it('rejects loudly when any fetch fails (no silent imageless renders)', async () => {
    const failing = async (url: string) => { throw new Error(`image fetch failed (404): ${url}`) }
    await expect(inlineTreeImages(div(img('http://x/dead.png')), failing))
      .rejects.toThrow(/image fetch failed/)
  })
})
