import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  outputKey, createGraphRun, resolveGraphRun, ownsPrompt,
  ownedPromptIds, ownedOutputKeys, pendingRuns, __setGraphRunsDbForTests,
} from '../../server/utils/graphRuns'

const query = vi.fn()
beforeEach(() => { query.mockReset(); __setGraphRunsDbForTests({ query }) })

describe('outputKey', () => {
  it('defaults type=output, subfolder empty', () => {
    expect(outputKey({ filename: 'a.png' })).toBe('output::a.png')
    expect(outputKey({ filename: 'a.png', subfolder: 's', type: 'temp' })).toBe('temp:s:a.png')
  })
})

describe('graphRuns', () => {
  it('createGraphRun inserts a pending row', async () => {
    query.mockResolvedValue({ rows: [] })
    await createGraphRun({ promptId: 'p1', userId: 'u1', credits: 7, holdId: 42 })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO graph_runs/i)
    expect(params).toEqual(['p1', 'u1', 7, 42])
  })

  it('resolveGraphRun records state and outputs', async () => {
    query.mockResolvedValue({ rows: [] })
    await resolveGraphRun('p1', 'settled', ['output::a.png'])
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/UPDATE graph_runs/i)
    expect(params[0]).toBe('settled')
    expect(JSON.parse(params[1])).toEqual(['output::a.png'])
    expect(params[2]).toBe('p1')
  })

  it('ownsPrompt is true only when a row matches both ids', async () => {
    query.mockResolvedValueOnce({ rows: [{ ok: 1 }] })
    expect(await ownsPrompt('u1', 'p1')).toBe(true)
    query.mockResolvedValueOnce({ rows: [] })
    expect(await ownsPrompt('u1', 'p2')).toBe(false)
  })

  it('ownedOutputKeys unions outputs across rows', async () => {
    query.mockResolvedValue({ rows: [{ outputs: ['output::a.png'] }, { outputs: ['output::b.png', 'temp::c.png'] }] })
    const keys = await ownedOutputKeys('u1')
    expect(keys).toEqual(new Set(['output::a.png', 'output::b.png', 'temp::c.png']))
  })

  it('pendingRuns returns only pending rows for the user', async () => {
    query.mockResolvedValue({ rows: [{ prompt_id: 'p1', hold_id: 42, credits: 7 }] })
    const runs = await pendingRuns('u1')
    expect(runs).toEqual([{ promptId: 'p1', holdId: 42, credits: 7 }])
    expect(query.mock.calls[0][0]).toMatch(/state = 'pending'/)
  })
})
