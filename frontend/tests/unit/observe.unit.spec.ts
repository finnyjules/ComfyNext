import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { captureError, __setSentryForTests } from '../../server/utils/observe'

describe('captureError', () => {
  const stub = { captureException: vi.fn() }

  beforeEach(() => {
    stub.captureException.mockReset()
    __setSentryForTests(stub)
    delete process.env.SENTRY_DSN
  })

  afterEach(() => {
    __setSentryForTests(null)
    delete process.env.SENTRY_DSN
  })

  it('no DSN → no-op, never throws, stub not called', () => {
    expect(() => captureError(new Error('boom'), { model: 'y' })).not.toThrow()
    expect(stub.captureException).not.toHaveBeenCalled()
  })

  it('DSN set → forwards to Sentry.captureException', () => {
    process.env.SENTRY_DSN = 'https://pub@example.ingest.sentry.io/1'
    const err = new Error('boom')
    captureError(err)
    expect(stub.captureException).toHaveBeenCalledTimes(1)
    expect(stub.captureException.mock.calls[0][0]).toBe(err)
  })

  it('scrubs prompt-bearing keys but keeps the rest', () => {
    process.env.SENTRY_DSN = 'https://pub@example.ingest.sentry.io/1'
    captureError(new Error('x'), { prompt: 'secret', text: 'more', positive: 'p', negative: 'n', model: 'y', jobId: 'rep:1' })
    const arg = stub.captureException.mock.calls[0][1]
    const extra = arg.extra
    expect(extra).not.toHaveProperty('prompt')
    expect(extra).not.toHaveProperty('text')
    expect(extra).not.toHaveProperty('positive')
    expect(extra).not.toHaveProperty('negative')
    expect(extra.model).toBe('y')
    expect(extra.jobId).toBe('rep:1')
  })

  it('never throws even if Sentry.captureException throws', () => {
    process.env.SENTRY_DSN = 'https://pub@example.ingest.sentry.io/1'
    stub.captureException.mockImplementation(() => { throw new Error('sentry down') })
    expect(() => captureError(new Error('x'), { model: 'z' })).not.toThrow()
  })
})
