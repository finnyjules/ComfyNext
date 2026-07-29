// @ts-expect-error — 'vite' is only a transitive dependency here (pulled in
// via Nuxt), not a direct one, so pnpm's strict node_modules does not link a
// top-level `vite` package for this workspace to resolve — for types as well
// as at runtime (`error TS2307: Cannot find module 'vite'`). This `import
// type` is NOT type safety: it cannot actually be checked, and it is erased
// at build time, so the build succeeds regardless of whether it resolves.
// It exists purely as documentation of the intended shape of `config` below.
// This file also sits outside the Nuxt tsconfig's `include` globs, so the
// repo-wide typecheck never sees this line either way; the directive is here
// only to keep an editor that opens this file directly from showing a red
// squiggle. Do not chase making `vite` resolvable — that would require
// promoting it to a direct dependency for no functional benefit.
import type { UserConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Builds each embed adapter as a standalone IIFE for inlining into exported
// .html files. Separate from the Nuxt build on purpose: nothing here may pull
// in Vue, Nuxt, or anything that reaches the network.
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
      // Required by Vite's lib-mode API when formats includes 'iife' (it's
      // the global Rollup would assign the entry's exports to), but unused
      // here in practice: the entry has zero exports, so nothing is ever
      // assigned to this name and it appears nowhere in the built output.
      // Do not go looking for `window.__SailorEmbedShader` at runtime.
      name: '__SailorEmbedShader',
      fileName: () => 'shader.js',
    },
    minify: 'esbuild',
    // Everything must be inlined — an embed has no module loader and no network.
    rollupOptions: { external: [] },
  },
}

export default config
