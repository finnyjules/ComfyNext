import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  runtimeConfig: {
    // Server-only. Set via NUXT_REPLICATE_TOKEN env var.
    // Used by /api/cloud-train/* routes; never exposed to the browser.
    replicateToken: '',
    // Max trainings the queue runner keeps in flight on Replicate at once.
    // Override via NUXT_TRAINING_MAX_CONCURRENCY. Default 2.
    trainingMaxConcurrency: '2',
    // Server-only shared Anthropic key powering all AI-assist routes.
    // Set via NUXT_ANTHROPIC_API_KEY. Users may still paste their own key in
    // Settings → AI as a per-browser override; that one is sent per-request.
    anthropicApiKey: '',
    public: {
      // Public origin the ComfyUI canvas iframe loads from. Empty in dev →
      // falls back to http://127.0.0.1:8188. In production set via
      // NUXT_PUBLIC_COMFY_ORIGIN (e.g. https://comfynext.fly.dev:8188).
      comfyOrigin: '',
    },
  },

  modules: [
    '@nuxtjs/color-mode',
    '@nuxt/fonts',
    // Inline module: proxy WebSocket upgrades on /ws to ComfyUI (dev only).
    //
    // WHY NOT `server.on('upgrade', …)`: Nuxt's dev CLI registers its OWN
    // upgrade listener on the listhen server BEFORE our `listen` hook fires
    // (see @nuxt/cli dev-*.mjs — it forwards every non-Vite-HMR upgrade to
    // `nuxt.server.upgrade`, i.e. Vite/Nitro's WS layer). Node invokes ALL
    // upgrade listeners, so a plain `.on('upgrade')` meant BOTH handlers ran on
    // `/ws`: ours piped to ComfyUI while Nuxt's simultaneously routed it into
    // SSR ("[Vue Router] No match found for /ws?clientId=…"), and the two
    // writing the same socket produced an unhandled `write ECONNRESET` that
    // CRASHED the dev server. The fix: capture and DETACH the pre-existing
    // upgrade listeners, then install ONE dispatcher that owns `/ws` exclusively
    // and delegates every other upgrade (Vite HMR etc.) to the saved listeners.
    function (_options, nuxt) {
      if (!nuxt.options.dev) return
      nuxt.hook('listen', (server: http.Server) => {
        // Idempotency across Nitro rebuilds / hook re-fires: install once.
        if ((server as any).__comfyWsProxyInstalled) return
        ;(server as any).__comfyWsProxyInstalled = true

        // Take over upgrade routing: snapshot the listeners Nuxt already added,
        // remove them, and reinstall them behind our /ws gate.
        const priorUpgradeListeners = server.listeners('upgrade') as Array<
          (req: http.IncomingMessage, socket: any, head: Buffer) => void
        >
        server.removeAllListeners('upgrade')

        server.on('upgrade', (req, socket, head) => {
          if (!req.url?.startsWith('/ws')) {
            // Not ours — hand back to Vite HMR / Nitro's original handler(s).
            for (const fn of priorUpgradeListeners) fn(req, socket, head)
            return
          }

          // Guard our own end: a client that aborts mid-handshake must never
          // become an unhandled 'error' (ECONNRESET/EPIPE) that crashes dev.
          socket.on('error', () => socket.destroy())

          const proxyReq = http.request({
            hostname: '127.0.0.1',
            port: 8188,
            path: req.url,
            method: 'GET',
            // Rewrite Origin (and Host) to the ComfyUI origin so its
            // origin-check middleware sees origin == host and returns 101
            // instead of 403 — mirrors server/middleware/comfyui-proxy.ts.
            headers: { ...req.headers, host: '127.0.0.1:8188', origin: 'http://127.0.0.1:8188' },
          })

          proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
            proxySocket.on('error', () => socket.destroy())

            let response = 'HTTP/1.1 101 Switching Protocols\r\n'
            for (const [key, value] of Object.entries(proxyRes.headers)) {
              if (value) response += `${key}: ${value}\r\n`
            }
            response += '\r\n'
            socket.write(response)
            if (proxyHead.length) socket.write(proxyHead)
            proxySocket.pipe(socket)
            socket.pipe(proxySocket)
            // ECONNRESET/EPIPE on either side just tears down the peer — never
            // an unhandled rejection.
            proxySocket.on('error', () => socket.destroy())
            socket.on('error', () => proxySocket.destroy())
          })

          proxyReq.on('error', (err) => {
            console.error('[comfy-ws-proxy] upstream error:', (err as Error).message)
            socket.destroy()
          })

          proxyReq.end()
        })
        console.log('[comfy-ws-proxy] WebSocket proxy for /ws → ComfyUI:8188 ready')
      })
    },
    // Inline module: strip dev harness routes (pages/dev/**, engine-test,
    // sgtest, …) from production builds so hosted deploys don't ship debug
    // surfaces. `nuxt dev` keeps them all.
    function (_options, nuxt) {
      if (nuxt.options.dev) return
      const DEV_PAGES = /^\/(dev(\/|$)|engine-test|sgtest|streamertest|timeline-harness|gl-conformance)/
      nuxt.hook('pages:extend', (pages) => {
        for (let i = pages.length - 1; i >= 0; i--) {
          if (DEV_PAGES.test(pages[i]!.path)) pages.splice(i, 1)
        }
      })
    },
  ],

  css: [
    '~/assets/css/main.css',
    '~/assets/css/comfyhub/global.scss',
    '~/assets/css/comfy-partner-icons.css',
  ],

  colorMode: {
    classSuffix: '',
    preference: 'dark',
    fallback: 'dark',
  },

  components: [
    {
      path: '~/components/ui',
      extensions: ['.vue'],
      prefix: 'Ui',
    },
    {
      path: '~/components',
      extensions: ['.vue'],
      ignore: ['ui/**', 'community/**'],
    },
  ],

  devServer: {
    host: '127.0.0.1',
  },

  // /ws WebSocket upgrades handled by the inline module above.
  // ComfyUI iframes load directly from http://127.0.0.1:8188.
  // API paths (/queue, /api, etc.) proxied by server/middleware/comfyui-proxy.ts.

  vite: {
    plugins: [tailwindcss()],
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@import "@/assets/css/comfyhub/_variables";\n@import "@/assets/css/comfyhub/_mixins";\n`,
        },
      },
    },
    // Pre-bundle the deps Vite would otherwise discover on first use. Without
    // this, hitting an un-bundled dep mid-session makes Vite re-optimize and
    // force a full page reload — the "click New workflow, nothing happens,
    // then it randomly works a minute later" stall. This list is exactly what
    // Vite's "discovered new dependencies at runtime" warning recommends.
    optimizeDeps: {
      include: [
        '@vue-flow/core',
        '@vue-flow/background',
        '@vue-flow/minimap',
        '@vueuse/core',
        'gsap',
        'jszip',
        'lucide-vue-next',
        'reka-ui',
        '@faker-js/faker',
        'clsx',
        'tailwind-merge',
      ],
    },
    // Vite 7 defaults `allowedHosts` to localhost variants only — anything
    // else gets "Upgrade Required". Allow all hosts in dev so headless
    // preview tooling (which sends a non-localhost Host header) can drive
    // the page for debugging.
    server: {
      allowedHosts: true,
    },
  },

  future: {
    compatibilityVersion: 4,
  },
})
