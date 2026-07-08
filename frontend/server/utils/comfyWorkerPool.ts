// ComfyUI worker pool: extra headless ComfyUI instances (`--cpu`, no UI) used
// for cloud-only prompts so they don't queue behind the user's own canvas
// session on :8188. State is HMR-safe on globalThis (trainingQueue.ts
// precedent) and the reap timer lives in server/plugins/comfyWorkerPool.ts.
//
// This file is split into PURE parts (workerPort, shouldReap, poolSize — unit
// tested without a Nuxt runtime) and IMPURE parts (ensureWorker/touchWorker,
// which spawn processes and poll network) so Task 3's tests can run without
// ever starting a real ComfyUI instance. Live spawn/poll verification happens
// in Task 8.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface WorkerState {
  index: number
  port: number
  status: 'stopped' | 'starting' | 'ready'
  pid?: number
  lastUsedAt: number
}

const DEFAULT_IDLE_MS = 15 * 60_000
const BASE_PORT = 8189
const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 30_000
const HEALTH_TIMEOUT_MS = 2000
const MIN_POOL_SIZE = 0
const MAX_POOL_SIZE = 4
const DEFAULT_POOL_SIZE = 2

/** Port for worker `index`: 8189, 8190, 8191, 8192 for indices 0-3. */
export function workerPort(index: number): number {
  return BASE_PORT + index
}

/**
 * A worker is reapable once it's ready, was spawned by us (adopted workers —
 * no `pid` — are never touched), and has been idle past `idleMs` (default
 * 15 minutes). Boundary is strict `>` so exactly-at-threshold survives one
 * more tick.
 */
export function shouldReap(w: WorkerState, now: number, idleMs: number = DEFAULT_IDLE_MS): boolean {
  if (w.status !== 'ready') return false
  if (!w.pid) return false
  return now - w.lastUsedAt > idleMs
}

/**
 * Reads runtimeConfig.comfyPoolSize (env NUXT_COMFY_POOL_SIZE), defaulting to
 * 2 and clamping to [0, 4]. Falls back to reading the env var directly when
 * called outside a Nuxt/Nitro context (e.g. plain vitest unit tests), since
 * `useRuntimeConfig` is a Nitro auto-import that doesn't exist in that case.
 */
export function poolSize(): number {
  let raw: string | undefined
  try {
    // `useRuntimeConfig` is auto-imported by Nitro; guarded for plain-node/test contexts.
    raw = (useRuntimeConfig() as any)?.comfyPoolSize
  } catch {
    raw = undefined
  }
  if (raw === undefined || raw === '') raw = process.env.NUXT_COMFY_POOL_SIZE
  const n = Number(raw)
  const value = Number.isFinite(n) ? n : DEFAULT_POOL_SIZE
  return Math.min(MAX_POOL_SIZE, Math.max(MIN_POOL_SIZE, value))
}

function comfyPython(repoRoot: string): string {
  let raw: string | undefined
  try {
    raw = (useRuntimeConfig() as any)?.comfyPython
  } catch {
    raw = undefined
  }
  if (!raw) raw = process.env.NUXT_COMFY_PYTHON
  return raw || path.join(repoRoot, '.venv', 'bin', 'python3.12')
}

/**
 * Resolves the ComfyUI checkout root (the directory containing main.py),
 * which is the PARENT of `frontend/`. In dev/prod `process.cwd()` is the
 * `frontend/` directory Nitro was started from, so `../` is the repo root —
 * the same convention already used by server/api/lipsync/speech.post.ts
 * (`path.resolve(process.cwd(), '..', 'input')`). If that guess doesn't
 * contain main.py (e.g. an unusual launch cwd), search upward for it before
 * falling back to the explicit NUXT_COMFY_ROOT override.
 */
export function resolveRepoRoot(): string {
  const envOverride = process.env.NUXT_COMFY_ROOT
  if (envOverride && existsSync(path.join(envOverride, 'main.py'))) return envOverride

  const guess = path.resolve(process.cwd(), '..')
  if (existsSync(path.join(guess, 'main.py'))) return guess

  // Search upward from cwd for a directory containing main.py.
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'main.py'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Nothing found — fall back to the env override (even if unverified) or
  // the original guess so callers get a deterministic path rather than a throw.
  return envOverride || guess
}

interface PoolGlobal {
  __cnComfyPool?: Map<number, WorkerState>
  __cnComfyPoolProcs?: Map<number, ChildProcess>
}
const g = globalThis as unknown as PoolGlobal

function poolMap(): Map<number, WorkerState> {
  if (!g.__cnComfyPool) g.__cnComfyPool = new Map()
  return g.__cnComfyPool
}

function procMap(): Map<number, ChildProcess> {
  if (!g.__cnComfyPoolProcs) g.__cnComfyPoolProcs = new Map()
  return g.__cnComfyPoolProcs
}

/** Snapshot of current worker states, for the reap timer and diagnostics. */
export function listWorkers(): WorkerState[] {
  return Array.from(poolMap().values())
}

export function getWorkerProcess(index: number): ChildProcess | undefined {
  return procMap().get(index)
}

export function removeWorker(index: number): void {
  poolMap().delete(index)
  procMap().delete(index)
}

async function checkHealth(port: number, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/system_stats`, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Ensures worker `index` is running and ready, spawning it if necessary.
 * - If a live ComfyUI already answers on the target port, it's ADOPTED
 *   (status 'ready', no pid — the reaper must never kill it).
 * - Otherwise spawns `main.py --listen 127.0.0.1 --port <port> --cpu` and
 *   polls /system_stats every second up to 30s. On timeout the spawned
 *   process is killed and the worker is marked 'stopped'.
 */
export async function ensureWorker(index: number): Promise<WorkerState> {
  const pool = poolMap()
  const port = workerPort(index)
  const existing = pool.get(index)
  if (existing && existing.status === 'ready') {
    return existing
  }

  // Adoption check: something is already answering on this port.
  if (await checkHealth(port, HEALTH_TIMEOUT_MS)) {
    const adopted: WorkerState = { index, port, status: 'ready', lastUsedAt: Date.now() }
    pool.set(index, adopted)
    return adopted
  }

  const starting: WorkerState = { index, port, status: 'starting', lastUsedAt: Date.now() }
  pool.set(index, starting)

  const repoRoot = resolveRepoRoot()
  const python = comfyPython(repoRoot)
  const child = spawn(python, ['main.py', '--listen', '127.0.0.1', '--port', String(port), '--cpu'], {
    cwd: repoRoot,
    stdio: 'ignore',
    detached: false,
  })
  procMap().set(index, child)
  starting.pid = child.pid

  // Handle spawn errors (e.g., bad python path, missing .venv) so the Nitro server
  // doesn't crash on an unhandled 'error' event. Marks the worker stopped immediately
  // so the poll loop exits cleanly.
  child.on('error', (err) => {
    console.warn('[comfy-pool] spawn failed for worker %d: %s', index, err.message)
    procMap().delete(index)
    const stopped: WorkerState = { index, port, status: 'stopped', lastUsedAt: Date.now() }
    pool.set(index, stopped)
  })

  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    // If spawn errored, the worker state is 'stopped' and procMap is empty — exit loop.
    if (!procMap().has(index)) {
      return pool.get(index) || { index, port, status: 'stopped', lastUsedAt: Date.now() }
    }
    if (await checkHealth(port, HEALTH_TIMEOUT_MS)) {
      const ready: WorkerState = { index, port, status: 'ready', pid: child.pid, lastUsedAt: Date.now() }
      pool.set(index, ready)
      return ready
    }
  }

  // Timed out — kill the process we spawned and report failure.
  try {
    child.kill('SIGTERM')
  } catch {
    // already dead
  }
  procMap().delete(index)
  const stopped: WorkerState = { index, port, status: 'stopped', lastUsedAt: Date.now() }
  pool.set(index, stopped)
  return stopped
}

/** Marks a worker as just-used, resetting the idle clock the reaper checks. */
export function touchWorker(index: number): void {
  const pool = poolMap()
  const w = pool.get(index)
  if (w) w.lastUsedAt = Date.now()
}
