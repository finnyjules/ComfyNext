import type { UserConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Builds each embed adapter as a standalone IIFE for inlining into exported
// .html files. Separate from the Nuxt build on purpose: nothing here may pull
// in Vue, Nuxt, or anything that reaches the network.
//
// `vite` is only a transitive dependency here (pulled in via Nuxt), not a
// direct one, so pnpm's strict node_modules does not link a top-level `vite`
// package for this workspace to resolve at runtime. `defineConfig` is purely
// an identity helper for type inference, so importing it as a value would
// force that resolution for no benefit — `import type` is erased at build
// time and sidesteps the problem entirely while keeping the config typed.
const config: UserConfig = {
  resolve: {
    alias: {
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  build: {
    outDir: 'public/embed',
    emptyOutDir: true,
    // outDir (public/embed) sits inside the default publicDir (public/), so
    // Vite's normal "copy publicDir into outDir" step would recursively copy
    // the whole public/ tree (app_covers, fonts, hero, house-styles, icons,
    // voice-samples, ...) into public/embed on every build. Nothing outside
    // outDir gets deleted — emptyOutDir only clears outDir itself — but left
    // on, this silently bloats the embed bundle output with unrelated app
    // assets. Disable the copy; this build has no publicDir assets of its own.
    copyPublicDir: false,
    lib: {
      entry: fileURLToPath(new URL('./app/lib/embed/entry-shader.ts', import.meta.url)),
      formats: ['iife'],
      name: '__SailorEmbedShader',
      fileName: () => 'shader.js',
    },
    minify: 'esbuild',
    // Everything must be inlined — an embed has no module loader and no network.
    rollupOptions: { external: [] },
  },
}

export default config
