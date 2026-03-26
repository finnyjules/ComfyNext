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
]

// Paths under PROXY_PREFIXES that should be handled by Nitro routes, not proxied
const NITRO_API_PATHS = ['/api/explain']
const NITRO_ROUTE_PREFIXES = ['/view', '/history']

export default defineEventHandler(async (event) => {
  const path = event.path

  // Skip proxying for Nitro's own API routes and server routes
  if (NITRO_API_PATHS.some((p) => path === p || path.startsWith(p + '?'))) return
  if (NITRO_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(p + '?') || path.startsWith(p + '/'))) return

  for (const prefix of PROXY_PREFIXES) {
    // Match /view, /view/, /view?query=..., /view/subpath, etc.
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) {
      const backendPath = path.startsWith('/comfyui')
        ? path.replace(/^\/comfyui/, '') || '/'
        : path
      return proxyRequest(event, `${COMFY_BACKEND}${backendPath}`)
    }
  }
})
