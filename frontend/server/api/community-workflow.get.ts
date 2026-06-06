/**
 * GET /api/community-workflow?slug=<slug>
 *
 * Fetches a workflow's graph JSON from comfy.org server-side, bypassing CORS.
 *
 * Two shapes exist on comfy.org:
 *   - Official templates:  /workflows/<slug>.json            (CORS-enabled)
 *   - Community workflows:  /workflows/download/<id>.json?filename=<id>
 *     where the community slug looks like "<id>-<id>". The download endpoint
 *     does NOT send CORS headers, so the browser can't fetch it directly —
 *     hence this server proxy.
 *
 * Must be allowlisted in server/middleware/comfyui-proxy.ts (NITRO_API_PATHS),
 * otherwise /api/* is proxied to ComfyUI and this 404s.
 */
export default defineEventHandler(async (event) => {
  const slug = String(getQuery(event).slug ?? '').trim()
  if (!slug || !/^[\w-]+$/.test(slug)) {
    throw createError({ statusCode: 400, message: 'Invalid or missing slug' })
  }

  // Try the official template URL first, then the community download endpoint.
  const id = slug.split('-')[0] || slug
  const candidates = [
    `https://comfy.org/workflows/${slug}.json`,
    `https://comfy.org/workflows/download/${id}.json?filename=${id}`,
  ]

  for (const url of candidates) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) continue
      if (!(res.headers.get('content-type') || '').includes('application/json')) continue
      const json = await res.json() as Record<string, unknown>
      // Sanity-check it's actually a ComfyUI graph, not an error/redirect page.
      if (json && (json.nodes || json.definitions || json.last_node_id !== undefined)) {
        return json
      }
    } catch { /* try next candidate */ }
  }

  throw createError({
    statusCode: 404,
    message: "This workflow's graph isn't available from comfy.org.",
  })
})
