import { defineConfig } from 'vitest/config'

// Unit tests for shared timeline logic (types, interpolate, commands) — pure
// TS, no Vue/Nuxt runtime needed. E2E stays in Playwright (tests/*.spec.ts);
// this only picks up tests/unit/**.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.unit.spec.ts'],
    environment: 'node',
  },
})
