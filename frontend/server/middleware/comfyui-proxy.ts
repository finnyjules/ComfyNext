// Proxy ComfyUI API paths to the backend.
// The ComfyUI iframes load directly from :8188, but the Nuxt frontend
// still makes fetch() calls to these paths (e.g. /queue, /comfyui/settings).

import { resolveWorkerTarget } from '../utils/workerRoute'
import { PROXY_PREFIXES } from '../utils/authGuard'
import { deployMode } from '../utils/deployMode'
import { handleMeteredPrompt } from '../utils/meterGraphRun'
import { handleHostedQueueGet, handleHostedInterrupt } from '../utils/engineGate'
import { normalizeEnginePath, hostedEngineDecision } from '../utils/enginePath'

// Paths under PROXY_PREFIXES that should be handled by Nitro routes, not proxied
const NITRO_API_PATHS = ['/api/explain', '/api/pipeline-suggest', '/api/font-suggest', '/api/secrets', '/api/render-template', '/api/lora-preview', '/api/replicate-cover', '/api/google-fonts', '/api/loras-local', '/api/lora-cover', '/api/community-workflow', '/api/voices-local', '/api/voice-preview-file', '/api/vibe', '/api/agent-plan', '/api/agent-review', '/api/image-search', '/api/image-fetch', '/api/copy-assist', '/api/ai-status', '/api/dataset-match', '/api/training-image', '/api/wallet']
const NITRO_API_PREFIXES = ['/api/billing', '/api/webhooks', '/api/admin', '/api/templates', '/api/cloud-train', '/api/voice-clone', '/api/training-queue', '/api/krea', '/api/vector', '/api/inpaint', '/api/house-styles', '/api/brand-kits', '/api/template-fonts', '/api/library-font', '/api/characters-local', '/api/lipsync', '/api/meter', '/api/pool', '/api/scene3d', '/api/style-profile', '/api/fonts', '/api/depth', '/api/taste', '/api/moodboards', '/api/wardrobe']
const NITRO_ROUTE_PREFIXES = ['/view', '/history']

export default defineEventHandler(async (event) => {
  const path = event.path

  // Skip proxying for Nitro's own API routes and server routes
  if (NITRO_API_PATHS.some((p) => path === p || path.startsWith(p + '?'))) return
  if (NITRO_API_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'))) return
  if (NITRO_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(p + '?') || path.startsWith(p + '/'))) return

  // Stage 5 review C1: ComfyUI serves every route at BOTH `/x` and `/api/x`,
  // and this proxy strips a leading `/comfyui` — so one endpoint has up to
  // four spellings. Gating a literal path left the other three as free
  // bypasses (unmetered /api/prompt, cross-tenant /comfyui/history, …).
  // Every hosted decision below is taken on the canonical form instead.
  //
  // LOCAL MODE: normalization is computed but never consulted — the raw
  // proxy loop below still sees the ORIGINAL path, so a local install
  // behaves exactly as it did before Stage 5.
  if (deployMode() === 'hosted' && PROXY_PREFIXES.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'))) {
    const decision = hostedEngineDecision(normalizeEnginePath(path), event.method)
    if (decision.kind === 'meterPrompt') return handleMeteredPrompt(event)
    if (decision.kind === 'queueGet') return handleHostedQueueGet(event)
    if (decision.kind === 'interrupt') return handleHostedInterrupt(event)
    // Deny by default: an engine path that isn't explicitly allowlisted for
    // hosted raw proxying is refused, so a route nobody has audited can
    // never become a cross-tenant surface merely by existing upstream.
    if (decision.kind === 'forbid') throw createError({ statusCode: 403, message: decision.message })
  }

  for (const prefix of PROXY_PREFIXES) {
    // Match /view, /view/, /view?query=..., /view/subpath, etc.
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) {
      // `?comfyWorker=N` selects a headless pool worker (8189+N) instead of
      // the main instance (8188); see server/utils/workerRoute.ts.
      const { port, cleanUrl } = resolveWorkerTarget(path)
      const target = `http://127.0.0.1:${port}`
      const backendPath = cleanUrl.startsWith('/comfyui')
        ? cleanUrl.replace(/^\/comfyui/, '') || '/'
        : cleanUrl
      // Override the Origin header so ComfyUI's origin-check middleware
      // sees host == origin (both 127.0.0.1:<port>) instead of blocking the
      // Nuxt dev-server port (3000) with a 403.
      return proxyRequest(event, `${target}${backendPath}`, {
        fetchOptions: { headers: { origin: target } },
      })
    }
  }
})
