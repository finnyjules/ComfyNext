/**
 * POST /api/voice-clone/from-youtube
 *
 * Body: { url: string, startSec: number, endSec: number }
 *
 * Downloads the [startSec, endSec] audio segment of a YouTube video as mp3
 * (via scripts/youtube_voice_clip.py — yt-dlp + static ffmpeg in the repo venv),
 * uploads it to Replicate's files API, and returns the public URL — the same
 * `voiceFileUrl` shape /api/voice-clone/upload returns, so the trainer's existing
 * clone-start flow consumes it unchanged.
 *
 * The caller must have the rights to clone the voice (their own content, a hired
 * voice actor, or licensed/public-domain audio). Enforced in the UI, not here.
 *
 * Allowlisted via the '/api/voice-clone' prefix in server/middleware/comfyui-proxy.ts.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CLIP_CAP_SEC = 60

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()

  const body = await readBody(event) as { url?: string, startSec?: number, endSec?: number }
  const url = (body?.url || '').trim()
  const startSec = Number(body?.startSec)
  const endSec = Number(body?.endSec)

  if (!/^https?:\/\//.test(url)) {
    throw createError({ statusCode: 400, message: 'A valid YouTube URL is required' })
  }
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    throw createError({ statusCode: 400, message: 'endSec must be greater than startSec' })
  }
  if (endSec - startSec > CLIP_CAP_SEC) {
    throw createError({ statusCode: 400, message: `Clip must be ${CLIP_CAP_SEC}s or shorter` })
  }

  // repo root is one level up from the Nitro cwd (frontend/)
  const root = path.resolve(process.cwd(), '..')
  const python = path.join(root, '.venv', 'bin', 'python')
  const script = path.join(root, 'scripts', 'youtube_voice_clip.py')
  const outPath = path.join(os.tmpdir(), `voice-yt_${Date.now()}.mp3`)

  // The helper writes the clip to exactly `outPath` and exits 0 on success; use
  // that path directly rather than parsing stdout (yt-dlp's \r progress pollutes
  // it). Errors come back on stderr.
  await new Promise<void>((resolve, reject) => {
    execFile(
      python,
      [script, url, String(startSec), String(endSec), outPath],
      { timeout: 120_000, maxBuffer: 1 << 20 },
      (err, _stdout, stderr) => {
        if (err) return reject(new Error((stderr || '').trim().split('\n').pop() || err.message))
        resolve()
      },
    )
  }).catch((e: Error) => {
    throw createError({ statusCode: 502, message: `Could not capture that segment: ${e.message}` })
  })
  const clipPath = outPath

  try {
    const data = await fs.readFile(clipPath)
    if (data.byteLength === 0) throw new Error('empty clip')

    const upstream = new FormData()
    upstream.append('content', new Blob([data], { type: 'audio/mpeg' }), 'youtube-voice.mp3')
    const res = await fetch('https://api.replicate.com/v1/files', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: upstream,
    })
    if (!res.ok) {
      throw createError({ statusCode: 502, message: `Upload failed: ${res.status} ${await res.text().catch(() => '')}` })
    }
    const j = await res.json() as { urls?: { get?: string } }
    const voiceFileUrl = j.urls?.get
    if (!voiceFileUrl) throw createError({ statusCode: 502, message: 'Upload returned no url' })
    return { voiceFileUrl, durationSec: Math.round(endSec - startSec) }
  } finally {
    await fs.unlink(clipPath).catch(() => {})
  }
})
