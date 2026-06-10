import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box'
import type { ISOFile, Sample as MP4Sample, Movie } from 'mp4box'
import type { FrameSource } from './frameSource'

/** Thrown when the platform can't WebCodecs-decode this file — callers fall
 *  back to VideoElementSource (the design doc's failure ladder). */
export class UnsupportedSourceError extends Error {}

const CACHE_FRAMES = 24   // decoded VideoFrames kept (closed on evict)
const DECODE_AHEAD = 6    // extra frames decoded past the request

interface Sample {
  isKey: boolean
  timestampUs: number    // presentation timestamp (cts)
  durationUs: number
  data: Uint8Array
}

/** Frame-exact MP4 video source: mp4box demux once at load, VideoDecoder
 *  decode-from-nearest-keyframe on cache miss. Samples are kept and fed to
 *  the decoder in DECODE order (exactly as mp4box delivers them) and outputs
 *  are mapped back to presentation indices by exact timestamp lookup, so
 *  B-frame files (presentation ≠ decode order) decode correctly. Compressed
 *  samples stay in memory (clip-scale files); decoded frames are the bounded
 *  LRU. The public getFrame(n) contract stays presentation-indexed. VFR files
 *  are rejected (UnsupportedSourceError) — constant frame duration is the
 *  frame↔time mapping assumption. */
export class WebCodecsSource implements FrameSource {
  private samples: Sample[] = []                 // DECODE order, as demuxed
  /** presentationOrder[p] = decode-order index of presentation frame p. */
  private presentationOrder: number[] = []
  /** Exact timestampUs → presentation index (no arithmetic rounding). */
  private indexByTimestamp = new Map<number, number>()
  private config!: VideoDecoderConfig
  private cache = new Map<number, VideoFrame>()  // insertion order = LRU
  private decoding: Promise<void> | null = null
  private _width = 0
  private _height = 0
  private disposed = false

  static async load(url: string): Promise<WebCodecsSource> {
    if (typeof VideoDecoder === 'undefined') {
      throw new UnsupportedSourceError('WebCodecs unavailable')
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error(`WebCodecsSource: ${res.status} fetching ${url}`)
    const buf = await res.arrayBuffer()

    const src = new WebCodecsSource()
    await src.demux(buf)
    const support = await VideoDecoder.isConfigSupported(src.config)
    if (!support.supported) {
      throw new UnsupportedSourceError(`codec ${src.config.codec} unsupported`)
    }
    return src
  }

  private demux(buf: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createFile()
      let settled = false
      let expected = 0
      const fail = (e: UnsupportedSourceError) => {
        if (!settled) { settled = true; reject(e) }
      }
      const finalize = () => {
        if (settled) return
        settled = true
        // samples stay in decode order; build the presentation↔decode maps
        this.presentationOrder = this.samples
          .map((_, dec) => dec)
          .sort((a, b) => this.samples[a]!.timestampUs - this.samples[b]!.timestampUs)
        // VFR rejection: constant frame duration is the frame↔time mapping
        // assumption. Checked on presentation-timestamp deltas rather than
        // per-sample stts durations — FFmpeg's muxer pads the last
        // decode-order sample's duration on B-frame files (dts ends before
        // the presentation end), which would falsely trip a per-sample check.
        const ts = (p: number) => this.samples[this.presentationOrder[p]!]!.timestampUs
        const d0 = this.samples[0]!.durationUs
        for (let p = 1; p < this.presentationOrder.length; p++) {
          if (Math.abs(ts(p) - ts(p - 1) - d0) > 1) {
            return reject(new UnsupportedSourceError('variable frame rate unsupported'))
          }
        }
        this.presentationOrder.forEach((dec, p) => {
          this.indexByTimestamp.set(this.samples[dec]!.timestampUs, p)
        })
        resolve()
      }
      file.onError = (module: string, message: string) =>
        fail(new UnsupportedSourceError(`demux: ${module}: ${message}`))
      file.onReady = (info: Movie) => {
        const track = info.videoTracks?.[0]
        if (!track?.video) return fail(new UnsupportedSourceError('no video track'))
        this._width = track.video.width
        this._height = track.video.height
        expected = track.nb_samples
        try {
          this.config = {
            codec: track.codec,
            codedWidth: track.video.width,
            codedHeight: track.video.height,
            description: extractDescription(file, track.id),
          }
        } catch (e) {
          return fail(e instanceof UnsupportedSourceError ? e
            : new UnsupportedSourceError(String(e)))
        }
        file.setExtractionOptions(track.id, undefined, { nbSamples: expected })
        file.start()
      }
      file.onSamples = (_id: number, _user: unknown, samples: MP4Sample[]) => {
        for (const s of samples) {
          if (!s.data) continue
          this.samples.push({
            isKey: !!s.is_sync,
            timestampUs: Math.round((s.cts * 1_000_000) / s.timescale),
            durationUs: Math.round((s.duration * 1_000_000) / s.timescale),
            data: new Uint8Array(s.data),
          })
        }
        if (expected > 0 && this.samples.length >= expected) finalize()
      }
      file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buf, 0))
      file.flush()
      // For a fully-buffered file mp4box delivers synchronously; anything not
      // here by the next microtask is never coming.
      queueMicrotask(() => {
        if (settled) return
        if (!this.samples.length) return fail(new UnsupportedSourceError('no samples'))
        finalize()
      })
    })
  }

  get width(): number { return this._width }
  get height(): number { return this._height }
  get frameCount(): number { return this.samples.length }

  async getFrame(n: number): Promise<TexImageSource> {
    const idx = Math.max(0, Math.min(n, this.samples.length - 1))
    const hit = this.cache.get(idx)
    if (hit) {
      this.cache.delete(idx)   // refresh LRU position
      this.cache.set(idx, hit)
      return hit
    }
    while (this.decoding) await this.decoding   // serialize decoder use
    if (this.cache.has(idx)) return this.getFrame(idx)
    this.decoding = this.decodeRange(idx)
    try {
      await this.decoding
    } finally {
      this.decoding = null
    }
    const frame = this.cache.get(idx)
    if (!frame) throw new Error(`WebCodecsSource: frame ${idx} did not decode`)
    return frame
  }

  /** Decode (in decode order) from the nearest keyframe at or before the
   *  target's decode position through targetDec + DECODE_AHEAD. Outputs are
   *  mapped back to presentation indices by exact timestamp — with B-frames
   *  the ahead window may emit slightly different presentation frames;
   *  correctness comes from the flush + timestamp mapping. */
  private decodeRange(targetPres: number): Promise<void> {
    const targetDec = this.presentationOrder[targetPres]!
    let startDec = targetDec
    while (startDec > 0 && !this.samples[startDec]!.isKey) startDec--
    const endDec = Math.min(this.samples.length - 1, targetDec + DECODE_AHEAD)

    return new Promise((resolve, reject) => {
      const fail = (e: unknown) => {
        try { decoder.close() } catch {}
        reject(e)
      }
      const decoder = new VideoDecoder({
        output: (frame) => {
          const p = this.indexByTimestamp.get(frame.timestamp)
          if (p !== undefined && !this.cache.has(p) && !this.disposed) {
            this.cache.set(p, frame)
            this.evict()
          } else {
            frame.close()  // unknown timestamp, duplicate, or disposed
          }
        },
        error: fail,
      })
      decoder.configure(this.config)
      for (let i = startDec; i <= endDec; i++) {
        const s = this.samples[i]!
        decoder.decode(new EncodedVideoChunk({
          type: s.isKey ? 'key' : 'delta',
          timestamp: s.timestampUs,
          duration: s.durationUs,
          data: s.data as BufferSource,
        }))
      }
      decoder.flush().then(() => {
        decoder.close()
        resolve()
      }, fail)
    })
  }

  private evict(): void {
    while (this.cache.size > CACHE_FRAMES) {
      const [oldest, frame] = this.cache.entries().next().value as [number, VideoFrame]
      this.cache.delete(oldest)
      frame.close()
    }
  }

  dispose(): void {
    this.disposed = true
    for (const f of this.cache.values()) f.close()
    this.cache.clear()
    this.samples = []
    this.presentationOrder = []
    this.indexByTimestamp.clear()
  }
}

/** Pull the codec description box (avcC/hvcC/…) VideoDecoder.configure needs. */
function extractDescription(file: ISOFile, trackId: number): Uint8Array {
  const trak = file.getTrackById(trackId)
  const entries = (trak as any).mdia?.minf?.stbl?.stsd?.entries ?? []
  for (const entry of entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN)
      box.write(stream)
      return new Uint8Array(stream.buffer, 8) // strip the 8-byte box header
    }
  }
  throw new UnsupportedSourceError('no codec description box')
}
