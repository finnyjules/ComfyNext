// Proxy ComfyUI API paths to the backend.
// The ComfyUI iframes load directly from :8188, but the Nuxt frontend
// still makes fetch() calls to these paths (e.g. /queue, /comfyui/settings).

const COMFY_BACKEND = 'http://127.0.0.1:8188'

// Prefixes to proxy (without trailing slashes — matching uses startsWith)
const PROXY_PREFIXES = [
  '/comfyui',
  '/extensions',
  '/api',
  '/queue',
  '/prompt',
  '/interrupt',
  '/history',
  '/system_stats',
  '/view',
  '/upload',
  '/object_info',
  '/global_subgraphs',
  '/gate',
  '/comfynext',
]

// Paths under PROXY_PREFIXES that should be handled by Nitro routes, not proxied
const NITRO_API_PATHS = ['/api/explain', '/api/render-template', '/api/lora-preview', '/api/replicate-cover', '/api/google-fonts', '/api/loras-local', '/api/lora-cover', '/api/community-workflow']
const NITRO_API_PREFIXES = ['/api/templates', '/api/cloud-train', '/api/krea', '/api/vector', '/api/inpaint']
const NITRO_ROUTE_PREFIXES = ['/view', '/history']

export default defineEventHandler(async (event) => {
  const path = event.path

  // Skip proxying for Nitro's own API routes and server routes
  if (NITRO_API_PATHS.some((p) => path === p || path.startsWith(p + '?'))) return
  if (NITRO_API_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'))) return
  if (NITRO_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(p + '?') || path.startsWith(p + '/'))) return

  for (const prefix of PROXY_PREFIXES) {
    // Match /view, /view/, /view?query=..., /view/subpath, etc.
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) {
      const backendPath = path.startsWith('/comfyui')
        ? path.replace(/^\/comfyui/, '') || '/'
        : path
      // Override the Origin header so ComfyUI's origin-check middleware
      // sees host == origin (both 127.0.0.1:8188) instead of blocking the
      // Nuxt dev-server port (3000) with a 403.
      return proxyRequest(event, `${COMFY_BACKEND}${backendPath}`, {
        fetchOptions: { headers: { origin: COMFY_BACKEND } },
      })
    }
  }
})
