import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests for shared timeline logic (types, interpolate, commands) — pure
// TS, no Vue/Nuxt runtime needed. E2E stays in Playwright (tests/*.spec.ts);
// this only picks up tests/unit/**.
export default defineConfig({
  resolve: {
    alias: {
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.unit.spec.ts'],
    environment: 'node',
  },
})
