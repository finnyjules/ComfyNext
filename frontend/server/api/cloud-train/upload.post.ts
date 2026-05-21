/**
 * POST /api/cloud-train/upload
 *
 * Accepts a multipart form with field 'file' containing a dataset zip.
 * Forwards it to Replicate's files API and returns the public URL Replicate
 * issues, which we hand to the training prediction as `input_images`.
 *
 * The Replicate token lives in runtimeConfig (server-only env var
 * NUXT_REPLICATE_TOKEN) and is never exposed to the browser.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const token = (config as any).replicateToken
  if (!token) {
    throw createError({
      statusCode: 500,
      message: 'Replicate token not configured. Set NUXT_REPLICATE_TOKEN and restart the Nuxt server.',
    })
  }

  const parts = await readMultipartFormData(event)
  const zipPart = parts?.find((p) => p.name === 'file')
  if (!zipPart || !zipPart.data || zipPart.data.byteLength === 0) {
    throw createError({ statusCode: 400, message: 'Missing or empty `file` field' })
  }

  // Build the upstream multipart for Replicate. The files API expects field
  // name `content` with the file bytes.
  const upstream = new FormData()
  const blob = new Blob([zipPart.data], { type: 'application/zip' })
  upstream.append('content', blob, zipPart.filename || 'dataset.zip')

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
