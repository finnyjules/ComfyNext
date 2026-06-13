/**
 * POST /api/voice-clone/upload
 *
 * Accepts a multipart form with field 'file' containing the voice sample
 * (MP3/M4A/WAV). Forwards it to Replicate's files API and returns the public
 * URL, which we hand to minimax/voice-cloning as `voice_file`.
 *
 * Mirrors /api/cloud-train/upload, but preserves the audio content-type so
 * MiniMax can detect the format. The Replicate token is server-only.
 */
const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
}

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()

  const parts = await readMultipartFormData(event)
  const filePart = parts?.find((p) => p.name === 'file')
  if (!filePart || !filePart.data || filePart.data.byteLength === 0) {
    throw createError({ statusCode: 400, message: 'Missing or empty `file` field' })
  }

  const filename = filePart.filename || 'sample.mp3'
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'mp3'
  const contentType = filePart.type || AUDIO_TYPES[ext] || 'audio/mpeg'

  const upstream = new FormData()
  const blob = new Blob([filePart.data], { type: contentType })
  upstream.append('content', blob, filename)

  const res = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Token ${token}` },
    body: upstream,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw createError({ statusCode: res.status, message: `Replicate files API: ${text || res.statusText}` })
  }

  const data = await res.json() as { id: string; urls?: { get?: string } }
  const url = data.urls?.get
  if (!url) {
    throw createError({ statusCode: 502, message: 'Replicate files API returned no URL' })
  }
  return { id: data.id, url }
})
