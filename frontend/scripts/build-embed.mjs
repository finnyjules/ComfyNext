#!/usr/bin/env node
// Drives one `vite build --config vite.embed.config.ts` invocation per
// embeddable surface: shader, gradient, the (temporary — see spacetype.ts's
// factory doc) full spacetype.js monolith, and one spacetype-<id>.js per
// registered Space Type effect. package.json's build:embed used to be a
// single shell one-liner chaining three `vite build` calls; a fourth,
// per-effect chain can't be a hardcoded shell list without reintroducing the
// exact staleness risk this whole feature exists to avoid (a hardcoded id
// list silently drifting from effects/index.ts), so this script derives the
// id list from the SAME parser vite.embed.config.ts's virtual-module plugin
// uses (see spacetype-effect-list.mjs) and loops over it.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { getSpaceTypeEffectEntries } from './spacetype-effect-list.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONFIG = fileURLToPath(new URL('../vite.embed.config.ts', import.meta.url))

function runBuild(surfaceEnvValue) {
  const result = spawnSync('npx', ['vite', 'build', '--config', CONFIG], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, SAILOR_EMBED_SURFACE: surfaceEnvValue },
  })
  if (result.status !== 0) {
    console.error(`build:embed: vite build failed for SAILOR_EMBED_SURFACE=${surfaceEnvValue}`)
    process.exit(result.status ?? 1)
  }
}

const started = Date.now()

runBuild('shader')
runBuild('gradient')
// Kept for now — Task 2 (bundleNameFor in surfaces.ts) removes this monolith
// and the /embed/ fetch that currently targets it.
runBuild('spacetype')

const effects = getSpaceTypeEffectEntries()
for (const { id } of effects) {
  runBuild(`spacetype:${id}`)
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(`build:embed: built shader, gradient, spacetype, and ${effects.length} spacetype-<effect> bundles in ${seconds}s`)
