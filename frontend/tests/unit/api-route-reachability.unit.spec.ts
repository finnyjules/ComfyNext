/**
 * Every Nitro API route must be REACHABLE.
 *
 * `server/middleware/comfyui-proxy.ts` forwards everything under `/api/` to the
 * ComfyUI backend unless the path is on its allowlist. A new route file is
 * therefore invisible by default: it is written, typed, unit-tested, and then
 * quietly swallowed by the proxy, which answers a POST with 405.
 *
 * That is not hypothetical. `/api/vibe-review`, `/api/vibe-recipes` and
 * `/api/vibe-pick` all shipped without their allowlist entries, so the see-first
 * review and the whole compose-and-pick flow were unreachable in the real app
 * from the day they landed — every call failed, every failure degraded silently
 * to the old path, and the owner judged the old engine believing it was the new
 * one. Nothing caught it because every "live" verification faked `window.fetch`
 * and so never touched the transport.
 *
 * This guard is the fix for the CLASS: discover the route files on disk and
 * assert each one is reachable. It cannot be satisfied by a passing unit test.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NITRO_API_PATHS, NITRO_API_PREFIXES } from '../../server/lib/nitroApiPaths'

const serverRoot = fileURLToPath(new URL('../../server', import.meta.url))

// The REAL lists, imported from the module the middleware imports too — not
// scraped out of its source. A regex over source drifts silently the moment the
// literal is reformatted, and a guard that can quietly stop seeing anything is
// worse than none.
const PATHS = NITRO_API_PATHS
const PREFIXES = NITRO_API_PREFIXES

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (p.endsWith('.ts')) acc.push(p)
  }
  return acc
}

/** `server/api/vibe-recipes.post.ts` → `/api/vibe-recipes`. */
function routePath(file: string): string {
  const rel = relative(join(serverRoot, 'api'), file).replace(/\\/g, '/')
  const withoutExt = rel.replace(/\.(get|post|put|patch|delete)?\.?ts$/, '')
  return `/api/${withoutExt}`.replace(/\/index$/, '')
}

const reachable = (path: string) =>
  PATHS.includes(path) || PREFIXES.some(p => path === p || path.startsWith(`${p}/`))

describe('every API route is reachable through the proxy', () => {
  const files = walk(join(serverRoot, 'api'))

  it('the scan is alive', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  const unreachable = files.map(routePath).filter(p => !reachable(p))

  it('no route file is swallowed by the ComfyUI proxy', () => {
    expect(
      unreachable,
      'These routes exist on disk but are not on the proxy allowlist, so every '
      + 'request to them is forwarded to ComfyUI and answered 405. Add each to '
      + 'NITRO_API_PATHS (or a covering prefix) in server/middleware/comfyui-proxy.ts.',
    ).toEqual([])
  })

  it('the four-takes routes specifically', () => {
    // Named, because these are the ones that shipped unreachable.
    for (const p of ['/api/vibe', '/api/vibe-review', '/api/vibe-recipes', '/api/vibe-pick']) {
      expect(reachable(p), p).toBe(true)
    }
  })

  it('the guard would notice a route that is not listed', () => {
    // A control the test carries itself: an invented path must fail the check,
    // or this whole file is decoration.
    expect(reachable('/api/definitely-not-allowlisted')).toBe(false)
  })
})


describe('the assist routes all carry the key the same way', () => {
  // A transport mismatch — a different localStorage name, a different body
  // field, a route that reads the key itself instead of going through
  // `resolveAnthropicKey` — would 401 or 503 every real call while every faked
  // test passed. Exactly the shape of failure this file exists for.
  const ROUTES = ['vibe', 'vibe-review', 'vibe-recipes', 'vibe-pick']
  const client = readFileSync(fileURLToPath(new URL('../../app/composables/useVibeControl.ts', import.meta.url)), 'utf8')

  it.each(ROUTES)('server/api/%s.post.ts resolves the key like its siblings', (name) => {
    const src = readFileSync(join(serverRoot, 'api', `${name}.post.ts`), 'utf8')
    // The one helper that knows about hosted mode refusing a browser-supplied
    // key, and about the 503 when neither side has one.
    expect(src).toMatch(/resolveAnthropicKey\(useRuntimeConfig\(event\)\.anthropicApiKey, optionalApiKey\(body\?\.apiKey\)\)/)
  })

  it('the client reads ONE setting name and sends ONE body field, everywhere', () => {
    const reads = client.match(/getLocalSetting\('([^']+)'\)/g) ?? []
    expect(reads.length).toBeGreaterThanOrEqual(4)
    expect(new Set(reads)).toEqual(new Set(["getLocalSetting('Sailor.AI.AnthropicApiKey')"]))
    // `|| undefined` matters: an empty string would be sent as a key and refused
    // by the server rather than falling through to the server's own.
    const sends = client.match(/apiKey: apiKey \|\| undefined/g) ?? []
    expect(sends.length).toBeGreaterThanOrEqual(4)
  })
})
