#!/bin/sh
# Serves the built Nuxt production output (.output) — used to preview the app
# when the dev server's vite-node SSR can't run (e.g. under Node 24).
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)" || exit 1
exec env PORT="${PORT:-3003}" NITRO_PORT="${NITRO_PORT:-3003}" node .output/server/index.mjs
