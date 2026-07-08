import { describe, it, expect, vi } from 'vitest'
import { workerPort, shouldReap, poolSize, memoizeEnsure, type WorkerState } from '../../server/utils/comfyWorkerPool'

describe('workerPort', () => {
  it('maps index 0..N to 8189 + index', () => {
    expect(workerPort(0)).toBe(8189)
    expect(workerPort(1)).toBe(8190)
    expect(workerPort(3)).toBe(8192)
  })
})

describe('shouldReap', () => {
  const base: WorkerState = { index: 0, port: 8189, status: 'ready', pid: 1234, lastUsedAt: 0 }

  it('reaps a ready, self-spawned worker idle past the default 15min threshold', () => {
    const now = 15 * 60_000 + 1
    expect(shouldReap(base, now)).toBe(true)
  })

  it('does not reap when idle time is exactly at the threshold', () => {
    const now = 15 * 60_000
    expect(shouldReap(base, now)).toBe(false)
  })

  it('does not reap when idle time is under the threshold', () => {
    const now = 5 * 60_000
    expect(shouldReap(base, now)).toBe(false)
  })

  it('never reaps a non-ready worker', () => {
    const now = 20 * 60_000
    expect(shouldReap({ ...base, status: 'starting' }, now)).toBe(false)
    expect(shouldReap({ ...base, status: 'stopped' }, now)).toBe(false)
  })

  it('never reaps an adopted worker (no pid)', () => {
    const now = 20 * 60_000
    expect(shouldReap({ ...base, pid: undefined }, now)).toBe(false)
  })

  it('honors a custom idleMs override', () => {
    const now = 1000
    expect(shouldReap(base, now, 500)).toBe(true)
    expect(shouldReap(base, now, 5000)).toBe(false)
  })
})

describe('poolSize', () => {
  const ORIGINAL_ENV = { ...process.env }

  it('defaults to 2 when unset', () => {
    delete process.env.NUXT_COMFY_POOL_SIZE
    expect(poolSize()).toBe(2)
    Object.assign(process.env, ORIGINAL_ENV)
  })

  it('clamps garbage (non-numeric) values to the default of 2', () => {
    process.env.NUXT_COMFY_POOL_SIZE = 'not-a-number'
    expect(poolSize()).toBe(2)
    delete process.env.NUXT_COMFY_POOL_SIZE
    Object.assign(process.env, ORIGINAL_ENV)
  })

  it('clamps values above 4 down to 4', () => {
    process.env.NUXT_COMFY_POOL_SIZE = '10'
    expect(poolSize()).toBe(4)
    delete process.env.NUXT_COMFY_POOL_SIZE
    Object.assign(process.env, ORIGINAL_ENV)
  })

  it('clamps negative values up to 0', () => {
    process.env.NUXT_COMFY_POOL_SIZE = '-5'
    expect(poolSize()).toBe(0)
    delete process.env.NUXT_COMFY_POOL_SIZE
    Object.assign(process.env, ORIGINAL_ENV)
  })

  it('accepts an in-range value as-is', () => {
    process.env.NUXT_COMFY_POOL_SIZE = '3'
    expect(poolSize()).toBe(3)
    delete process.env.NUXT_COMFY_POOL_SIZE
    Object.assign(process.env, ORIGINAL_ENV)
  })
})

describe('memoizeEnsure (concurrent-spawn guard)', () => {
  const ready = (index: number): WorkerState => ({
    index, port: workerPort(index), status: 'ready', pid: 1, lastUsedAt: 0,
  })

  it('runs inner only ONCE for two overlapping calls on the same index', async () => {
    const ensuring = new Map<number, Promise<WorkerState>>()
    let resolveInner!: (w: WorkerState) => void
    const inner = vi.fn((index: number) =>
      new Promise<WorkerState>((res) => { resolveInner = () => res(ready(index)) }),
    )

    const p1 = memoizeEnsure(0, ensuring, inner)
    const p2 = memoizeEnsure(0, ensuring, inner) // overlapping: inner still pending

    expect(inner).toHaveBeenCalledTimes(1)
    expect(p1).toBe(p2) // both callers await the SAME promise
    expect(ensuring.has(0)).toBe(true)

    resolveInner(ready(0))
    await Promise.all([p1, p2])
    // finally clears the in-flight entry so a later call can re-run.
    expect(ensuring.has(0)).toBe(false)
  })

  it('runs inner again for a later, non-overlapping call (entry cleared after settle)', async () => {
    const ensuring = new Map<number, Promise<WorkerState>>()
    const inner = vi.fn((index: number) => Promise.resolve(ready(index)))

    await memoizeEnsure(1, ensuring, inner)
    await memoizeEnsure(1, ensuring, inner)

    expect(inner).toHaveBeenCalledTimes(2)
  })

  it('memoizes per index independently', () => {
    const ensuring = new Map<number, Promise<WorkerState>>()
    const inner = vi.fn((index: number) => new Promise<WorkerState>(() => {}))

    memoizeEnsure(0, ensuring, inner)
    memoizeEnsure(1, ensuring, inner)

    expect(inner).toHaveBeenCalledTimes(2)
    expect(inner).toHaveBeenNthCalledWith(1, 0)
    expect(inner).toHaveBeenNthCalledWith(2, 1)
  })

  it('clears the in-flight entry even when inner rejects', async () => {
    const ensuring = new Map<number, Promise<WorkerState>>()
    const inner = vi.fn(() => Promise.reject(new Error('spawn failed')))

    await expect(memoizeEnsure(2, ensuring, inner)).rejects.toThrow('spawn failed')
    expect(ensuring.has(2)).toBe(false)
  })
})
