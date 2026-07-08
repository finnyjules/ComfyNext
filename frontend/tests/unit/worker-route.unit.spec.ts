import { describe, it, expect } from 'vitest'
import { resolveWorkerTarget } from '../../server/utils/workerRoute'

describe('resolveWorkerTarget', () => {
  it('routes to main (8188) when comfyWorker param is absent, url unchanged', () => {
    expect(resolveWorkerTarget('/ws?clientId=abc')).toEqual({
      port: 8188,
      cleanUrl: '/ws?clientId=abc',
    })
  })

  it('routes to worker 1 (8190) and strips the param', () => {
    expect(resolveWorkerTarget('/ws?comfyWorker=1')).toEqual({
      port: 8190,
      cleanUrl: '/ws',
    })
  })

  it('routes to worker 0 (8189) and preserves other params, dropping only comfyWorker', () => {
    expect(resolveWorkerTarget('/ws?clientId=x&comfyWorker=0')).toEqual({
      port: 8189,
      cleanUrl: '/ws?clientId=x',
    })
  })

  it('falls back to 8188 for garbage values, still stripping the param', () => {
    expect(resolveWorkerTarget('/ws?comfyWorker=garbage')).toEqual({
      port: 8188,
      cleanUrl: '/ws',
    })
  })

  it('falls back to 8188 for negative values', () => {
    expect(resolveWorkerTarget('/ws?comfyWorker=-1')).toEqual({
      port: 8188,
      cleanUrl: '/ws',
    })
  })

  it('falls back to 8188 for values above the max pool index (7)', () => {
    expect(resolveWorkerTarget('/ws?comfyWorker=99')).toEqual({
      port: 8188,
      cleanUrl: '/ws',
    })
  })

  it('accepts the upper boundary N=7 → 8196', () => {
    expect(resolveWorkerTarget('/ws?comfyWorker=7')).toEqual({
      port: 8196,
      cleanUrl: '/ws',
    })
  })

  it('preserves a param that appears before comfyWorker plus one after', () => {
    expect(resolveWorkerTarget('/queue?a=1&comfyWorker=2&b=2')).toEqual({
      port: 8191,
      cleanUrl: '/queue?a=1&b=2',
    })
  })

  it('handles a bare path with no query string at all', () => {
    expect(resolveWorkerTarget('/queue')).toEqual({
      port: 8188,
      cleanUrl: '/queue',
    })
  })
})
