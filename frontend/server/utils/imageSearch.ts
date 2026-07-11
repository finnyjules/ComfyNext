/** Web image search (Brave Image Search API) — result normalization.
 *  Pure + defensive: Brave's payload is external input, so every field is
 *  checked and anything without a usable full-size url + thumbnail is dropped. */

export interface ImageSearchResult {
  id: string
  title: string
  thumbUrl: string
  imageUrl: string
  pageUrl: string
  source: string
  /** Original image dimensions — from Brave when it sends them, else probed
   *  from the image header; absent when neither worked. */
  width?: number
  height?: number
}

/** Best-effort dimension probe: ranged-fetch the first bytes of the image and
 *  sniff the header. Hosts that ignore Range still only cost ~128KB — the body
 *  stream is cancelled once enough bytes arrive. Null on any failure. */
export async function probeImageDimensions(url: string, timeoutMs = 4000): Promise<{ width: number; height: number } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'Range': 'bytes=0-131071', 'User-Agent': 'Mozilla/5.0 (compatible; Sailor image import)', 'Accept': 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (total < 131072) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) { chunks.push(value); total += value.byteLength }
    }
    reader.cancel().catch(() => {})
    const buf = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { buf.set(c, off); off += c.byteLength }
    return imageDimensionsFromBytes(buf)
  } catch {
    return null
  }
}

/** Image dimensions from the FIRST BYTES of a file — enough header to know the
 *  size without downloading the image (the probe ranged-fetches ~128KB). Covers
 *  what image search actually returns: JPEG, PNG, WebP, GIF. Null when the data
 *  is not a recognized image or the header is truncated. Pure. */
export function imageDimensionsFromBytes(b: Uint8Array): { width: number; height: number } | null {
  const view = () => new DataView(b.buffer, b.byteOffset, b.byteLength)
  // PNG: 8-byte signature, then the IHDR chunk holds width/height big-endian.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
    return { width: view().getUint32(16), height: view().getUint32(20) }
  }
  // GIF: "GIF8", logical screen descriptor at 6 (little-endian).
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return { width: view().getUint16(6, true), height: view().getUint16(8, true) }
  }
  // JPEG: walk the segment markers to a start-of-frame (SOFn), which carries the size.
  if (b.length >= 4 && b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue }
      const marker = b[i + 1]!
      if (marker === 0xFF) { i++; continue }
      // SOF0–SOF15 except DHT(C4)/JPG(C8)/DAC(CC)
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { width: view().getUint16(i + 7), height: view().getUint16(i + 5) }
      }
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD9)) { i += 2; continue } // markers with no payload
      i += 2 + view().getUint16(i + 2) // skip this segment
    }
    return null
  }
  // WebP: RIFF…WEBP, then the first chunk is VP8X (extended), VP8 (lossy) or VP8L (lossless).
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const tag = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)
    if (tag === 'VP8X') {
      const u24 = (o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)
      return { width: u24(24) + 1, height: u24(27) + 1 }
    }
    if (tag === 'VP8 ' && b[23] === 0x9D && b[24] === 0x01 && b[25] === 0x2A) {
      return { width: view().getUint16(26, true) & 0x3FFF, height: view().getUint16(28, true) & 0x3FFF }
    }
    if (tag === 'VP8L' && b[20] === 0x2F) {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
      return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 }
    }
  }
  return null
}

function httpUrl(v: unknown): string {
  return typeof v === 'string' && /^https?:\/\//i.test(v) ? v : ''
}

function dim(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined
}

export function normalizeBraveImageResults(data: unknown): ImageSearchResult[] {
  const results = (data as { results?: unknown })?.results
  if (!Array.isArray(results)) return []
  const out: ImageSearchResult[] = []
  for (const r of results) {
    const row = (r ?? {}) as { title?: unknown; url?: unknown; source?: unknown; properties?: { url?: unknown; width?: unknown; height?: unknown }; thumbnail?: { src?: unknown } }
    const imageUrl = httpUrl(row.properties?.url)
    const thumbUrl = httpUrl(row.thumbnail?.src)
    if (!imageUrl || !thumbUrl) continue
    // Both dimensions or neither — a lone width can't drive quality cues.
    const width = dim(row.properties?.width)
    const height = dim(row.properties?.height)
    out.push({
      id: `img_${out.length}_${imageUrl.slice(-24).replace(/[^a-z0-9]/gi, '')}`,
      title: typeof row.title === 'string' ? row.title : '',
      thumbUrl,
      imageUrl,
      pageUrl: httpUrl(row.url),
      source: typeof row.source === 'string' ? row.source : '',
      ...(width && height ? { width, height } : {}),
    })
  }
  return out
}
