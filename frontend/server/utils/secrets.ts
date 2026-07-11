// Server-held API tokens pasted from Settings → AI. Stored as a small JSON
// file under the Nuxt server's working directory (frontend/.data, gitignored)
// so they survive restarts without editing .env. Values pasted in Settings
// take precedence over env vars; the full token is never sent to the browser
// (only a masked tail via /api/secrets).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface SailorSecrets {
  replicateToken?: string
}

export function secretsFilePath(): string {
  return join(process.cwd(), '.data', 'sailor-secrets.json')
}

export function readSecretsFile(path = secretsFilePath()): SailorSecrets {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  catch {
    return {}
  }
}

export function writeSecretsFile(patch: Partial<SailorSecrets>, path = secretsFilePath()): SailorSecrets {
  const next: SailorSecrets = { ...readSecretsFile(path), ...patch }
  // Drop cleared values so env-var fallbacks apply again.
  for (const k of Object.keys(next) as (keyof SailorSecrets)[]) {
    if (!next[k]) delete next[k]
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}

export function maskToken(token: string | undefined | null): string | null {
  if (!token) return null
  return token.length > 4 ? `••••${token.slice(-4)}` : '••••'
}

/** Settings-pasted token wins; NUXT_REPLICATE_TOKEN env is the fallback. */
export function getReplicateToken(): string | null {
  return readSecretsFile().replicateToken
    || ((useRuntimeConfig() as any).replicateToken as string | undefined)
    || null
}
