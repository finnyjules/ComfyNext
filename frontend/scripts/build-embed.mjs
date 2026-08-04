#!/usr/bin/env node
// Drives one `vite build --config vite.embed.config.ts` invocation per
// embeddable surface: shader, gradient, and one spacetype-<id>.js per
// registered Space Type effect. The spacetype.js monolith (all 25 effects in
// one bundle) is no longer built — export.ts now selects a per-effect bundle
// via bundleNameFor (surfaces.ts), so nothing fetches it anymore.
// package.json's build:embed used to be a single shell one-liner chaining
// three `vite build` calls; a per-effect chain can't be a hardcoded shell
// list without reintroducing the exact staleness risk this whole feature
// exists to avoid (a hardcoded id list silently drifting from
// effects/index.ts), so this script derives the id list from the SAME parser
// vite.embed.config.ts's virtual-module plugin uses (see
// spacetype-effect-list.mjs) and loops over it.
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getSpaceTypeEffectEntries } from './spacetype-effect-list.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONFIG = fileURLToPath(new URL('../vite.embed.config.ts', import.meta.url))
// This build never emptys public/embed (see vite.embed.config.ts's
// emptyOutDir: false doc — each invocation only adds its own file), so a
// spacetype.js left over from before this monolith was retired would
// otherwise sit there forever, unbuilt but still served by the dev/prod
// static file server. Nothing fetches it anymore (see the module doc above),
// but a stale multi-megabyte file nobody remembers producing is exactly the
// kind of confusion "drop the monolith" means to prevent — so remove it
// proactively on every build:embed run rather than trusting every checkout to
// have wiped public/embed by hand.
const STALE_MONOLITH = fileURLToPath(new URL('../public/embed/spacetype.js', import.meta.url))

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

if (existsSync(STALE_MONOLITH)) {
  rmSync(STALE_MONOLITH)
  console.log('build:embed: removed stale public/embed/spacetype.js (monolith retired)')
}

runBuild('shader')
runBuild('gradient')

const effects = getSpaceTypeEffectEntries()
for (const { id } of effects) {
  runBuild(`spacetype:${id}`)
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(`build:embed: built shader, gradient, and ${effects.length} spacetype-<effect> bundles in ${seconds}s`)
