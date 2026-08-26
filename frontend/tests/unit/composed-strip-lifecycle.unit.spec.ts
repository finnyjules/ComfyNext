// The composed strip, end to end.
//
// The previous round shipped the compose-and-pick pipeline with tests for every
// pure function in it and NOT ONE for the strip it produces — so the terminal
// action, Keep, threw the user's pick away and nothing noticed. A composed take
// carries a whole config and no changes; every lifecycle step has to understand
// that, and these are the steps.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const fetchMock = vi.fn()
vi.mock('ofetch', () => ({ $fetch: (...args: unknown[]) => fetchMock(...args) }))
;(globalThis as any).$fetch = (...args: unknown[]) => fetchMock(...args)
;(globalThis as any).useLocalSettings = () => ({ getLocalSetting: () => 'test-key' })

const SIZE = 32
type Fake = { __buf: Uint8ClampedArray, toDataURL: () => string }
/** A picture whose bytes encode the config it came from, so a test can tell
 *  which config a tile or a preview is actually showing. */
function pictureOf(cfg: any): Fake {
  const shade = Math.max(0, Math.min(255, Number(cfg?.mark ?? 0)))
  const buf = new Uint8ClampedArray(SIZE * SIZE * 4).fill(shade)
  for (let i = 3; i < buf.length; i += 4) buf[i] = 255
  return { __buf: buf, toDataURL: () => `data:image/jpeg;base64,${btoa(String(shade))}` }
}
vi.mock('~/lib/agent/takeThumbs', () => ({
  takeThumbFor: () => async (config: any) => pictureOf(config),
}))

import { useStudioAgent } from '~/composables/useStudioAgent'
import { makeConfigParams } from '~/lib/agent/configParams'
import { readTakeLog } from '~/lib/agent/takes'
import type { ControlSpec } from '~/lib/spacetype/effect'

let drawn: Fake | null = null
;(globalThis as any).document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage: (src: Fake) => { drawn = src },
      getImageData: () => ({ data: drawn?.__buf ?? new Uint8ClampedArray(SIZE * SIZE * 4) }),
    }),
  }),
}
const store = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } },
}
afterAll(() => { delete (globalThis as any).window; delete (globalThis as any).document })

const CONTROLS: ControlSpec[] = [
  { key: 'tint', label: 'Tint', kind: 'slider', min: 0, max: 100, step: 1, default: 0 } as ControlSpec,
]

/** A toy studio with a compose menu: each recipe base becomes a distinct `mark`. */
function makeComposeAgent() {
  const state = { config: { mark: 10, tint: 0, note: 'the user’s own' } as any, view: 3 }
  const agent = useStudioAgent({
    controls: () => CONTROLS,
    params: makeConfigParams(() => state.config),
    label: () => 'Compose toy',
    takes: {
      studio: 'gradient',
      config: () => state.config,
      paramsOf: (c: unknown) => makeConfigParams(() => c),
      controls: () => CONTROLS,
      setConfig: (c: unknown) => { state.config = c },
      captureView: () => state.view,
      restoreView: (v: unknown) => { state.view = Number(v) },
      compose: {
        summarize: (c: any) => ({ base: String(c?.mark ?? '?'), palette: ['#112233'] }),
        materialize: (recipe: any, own: any) =>
          recipe.base === 'yours'
            ? { ...own, note: 'from yours' }
            : { mark: Number(recipe.name.replace(/\D/g, '')) || 99, tint: 0, note: recipe.name },
      },
    },
  } as any)
  return { agent, state }
}

const RECIPES = [40, 80, 120, 160, 200, 240].map(n => ({
  base: 'sunset', palette: ['#ff9a4d', '#4b2a7a'], mood: ['dreamy'], name: `look ${n}`,
}))

function wire(picks: unknown[] | 'fail' = [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }]) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/vibe-recipes')) return { recipes: RECIPES }
    if (String(url).includes('/api/vibe-pick')) {
      if (picks === 'fail') throw new Error('pick unavailable')
      return { picks }
    }
    throw new Error('the direct path must not be used in this flow')
  })
}

const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }

beforeEach(() => { fetchMock.mockReset(); store.clear(); drawn = null })

describe('a composed strip, from ask to keep', () => {
  it('opens with four takes that each carry a whole config', async () => {
    wire()
    const { agent } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()

    expect(agent.takes.value).toHaveLength(4)
    for (const t of agent.takes.value as any[]) {
      expect(t.config).toBeTruthy()
      expect(t.changes).toEqual([])
    }
    expect(agent.takeCurrentThumb.value).toBeTruthy() // the anchor tile has a picture
  })

  it('hovering installs the take’s config, and unhovering restores byte-exactly', async () => {
    wire()
    const { agent, state } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()
    const before = JSON.stringify(state.config)

    agent.previewTake(agent.takes.value[0])
    expect(state.config.note).toBe('look 40')
    expect(JSON.stringify(state.config)).not.toBe(before)

    agent.previewTake(null)
    expect(JSON.stringify(state.config)).toBe(before)
    expect(state.config.note).toBe('the user’s own')
  })

  it('KEEPS the config the user was looking at — not their old design', async () => {
    // The defect this file exists for: keep restored the original, found no
    // changes to commit, and handed back exactly what the user started with.
    wire()
    const { agent, state } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()

    const pick = agent.takes.value[1]!
    agent.selectTake(pick)
    const previewed = JSON.stringify(state.config)
    agent.keepTake()

    expect(JSON.stringify(state.config)).toBe(previewed)
    expect(state.config.note).toBe('look 80')
    expect(agent.hasTakes.value).toBe(false)
    // Committed for good: the take-path revert must not resurrect the old one.
    agent.revert()
    expect(state.config.note).toBe('look 80')
  })

  it('dismissing puts everything back, including the studio’s own view state', async () => {
    wire()
    const { agent, state } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()
    const before = JSON.stringify(state.config)

    agent.selectTake(agent.takes.value[2])
    state.view = 0 // as a config swap would leave it
    agent.dismissTakes()

    expect(JSON.stringify(state.config)).toBe(before)
    expect(state.view).toBe(3)
    expect(agent.hasTakes.value).toBe(false)
  })

  it('closing the studio mid-preview restores rather than saving the preview', async () => {
    wire()
    const { agent, state } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()
    const before = JSON.stringify(state.config)

    agent.previewTake(agent.takes.value[3])
    agent.abandonTakes()          // what the shell calls on ✕ / Escape
    expect(JSON.stringify(state.config)).toBe(before)
  })

  it('clicking "yours" goes back to the user’s design without closing', async () => {
    wire()
    const { agent, state } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()
    const before = JSON.stringify(state.config)

    agent.selectTake(agent.takes.value[0])
    agent.selectTake(null)
    expect(JSON.stringify(state.config)).toBe(before)
    expect(agent.hasTakes.value).toBe(true)
  })
})

describe('what a composed take leaves in the taste log', () => {
  it('records the recipe — the base, the colours and the moods', async () => {
    // The pick log is the whole taste-data thesis. A composed take has no
    // `changes` to record, so without the recipe it logs nothing about itself.
    wire()
    const { agent } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()

    agent.selectTake(agent.takes.value[0])
    agent.keepTake()
    const kept = readTakeLog().find(e => e.action === 'keep')!
    expect(kept.recipe).toMatchObject({ base: 'sunset', mood: ['dreamy'] })
    expect(kept.recipe!.palette).toEqual(['#ff9a4d', '#4b2a7a'])
  })
})

describe('the eye-pick failing costs ordering, never the strip', () => {
  it('still shows four, chosen by our own distinctness', async () => {
    wire('fail')
    const { agent } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()
    expect(agent.takes.value).toHaveLength(4)
    for (const t of agent.takes.value as any[]) expect(t.config).toBeTruthy()
  })
})

describe('re-rolling a composed strip stays in the composed flow', () => {
  it('composes again instead of falling back to the direct path', async () => {
    wire()
    const { agent } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()
    const before = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes('vibe-recipes')).length

    await agent.moreDirections()
    await flush()

    const after = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes('vibe-recipes')).length
    expect(after).toBe(before + 1)
    for (const t of agent.takes.value as any[]) expect(t.config).toBeTruthy()
  })

  it('tells the next round what it already showed, so it can diverge', async () => {
    wire()
    const { agent } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()
    const shown = (agent.takes.value as any[]).map(t => t.label)

    await agent.moreDirections()
    await flush()

    const body = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes('vibe-recipes')).at(-1)![1] as any
    for (const label of shown) expect(body.body.phrase).toContain(label)
  })
})


describe('paint first, let the eye reorder', () => {
  it('shows four before the eye-pick has answered', async () => {
    // The latency answer: our own ranking costs microseconds and the eye-pick is
    // a second network round trip. First paint must not wait for it.
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/vibe-recipes')) return { recipes: RECIPES }
      if (String(url).includes('/api/vibe-pick')) { await held; return { picks: [{ index: 4, label: 'the eye’s' }] } }
      throw new Error('direct path must not be used')
    })
    const { agent } = makeComposeAgent()
    const ask = agent.ask('a dreamy sunset')
    await flush(20)

    expect(agent.takes.value).toHaveLength(4)          // already up…
    const ours = (agent.takes.value as any[]).map(t => t.label)
    release()
    await ask
    await flush()

    // …and the pick reordered it in place afterwards.
    expect((agent.takes.value as any[])[0]!.label).toBe('the eye’s')
    expect((agent.takes.value as any[]).map(t => t.label)).not.toEqual(ours)
  })

  it('a pick that lands after the user moved on is dropped', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/vibe-recipes')) return { recipes: RECIPES }
      if (String(url).includes('/api/vibe-pick')) { await held; return { picks: [{ index: 5, label: 'STALE' }] } }
      throw new Error('direct path must not be used')
    })
    const { agent } = makeComposeAgent()
    const ask = agent.ask('a dreamy sunset')
    await flush(20)

    agent.dismissTakes()
    release()
    await ask
    await flush()

    expect(agent.hasTakes.value).toBe(false)
    expect(agent.takes.value).toEqual([])
  })

  /** A pick call held open, so a test can act while the strip is provisional. */
  function heldPick(picks: unknown[]) {
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/vibe-recipes')) return { recipes: RECIPES }
      if (String(url).includes('/api/vibe-pick')) { await held; return { picks } }
      throw new Error('direct path must not be used')
    })
    return () => release()
  }

  it('a HOVER when the pick lands does not become the new baseline', async () => {
    // The corruption: the baseline was re-captured on every paint, so a reorder
    // arriving while a candidate was on screen captured THE CANDIDATE as "the
    // user's design". Every later restore then landed on it, and the studio's
    // deep watcher saved it — a document quietly replaced by a hover.
    const release = heldPick([{ index: 4, label: 'the eye’s' }])
    const { agent, state } = makeComposeAgent()
    const ask = agent.ask('a dreamy sunset')
    await flush(20)
    const mine = JSON.stringify(state.config)

    agent.previewTake(agent.takes.value[0])          // hovering a provisional tile…
    expect(JSON.stringify(state.config)).not.toBe(mine)
    release()                                         // …when the pick lands
    await ask
    await flush()

    agent.previewTake(null)
    expect(JSON.stringify(state.config)).toBe(mine)
    agent.dismissTakes()
    expect(JSON.stringify(state.config)).toBe(mine)
  })

  it('a SELECTION when the pick lands leaves a coherent strip', async () => {
    // Whatever the policy, the canvas must never show a design no tile claims.
    const release = heldPick([{ index: 4, label: 'the eye’s' }])
    const { agent, state } = makeComposeAgent()
    const ask = agent.ask('a dreamy sunset')
    await flush(20)
    const mine = JSON.stringify(state.config)

    agent.selectTake(agent.takes.value[1])
    release()
    await ask
    await flush()

    const selected = agent.selectedTake.value as any
    if (selected) {
      // If a selection survives it must still be one of the tiles on screen, and
      // the canvas must be showing exactly it.
      expect(agent.takes.value).toContain(selected)
      expect(JSON.stringify(state.config)).toBe(JSON.stringify(selected.config))
    } else {
      // Otherwise the honest resting state: the user's own design, untouched.
      expect(JSON.stringify(state.config)).toBe(mine)
    }
    agent.dismissTakes()
    expect(JSON.stringify(state.config)).toBe(mine)
  })

  it('logs the strip as telemetry — measured, never badged', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    wire()
    const { agent } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()

    const said = info.mock.calls.flat().map(String).join(' ')
    expect(said).toContain('closest pair')
    // …and no tile wears a badge: the eye-pick is the gate in this flow.
    for (const t of agent.takes.value as any[]) expect(t.label).not.toMatch(/\((partial|differs|similar)\)/)
    info.mockRestore()
  })
})


describe('re-rolling keeps the OLD strip live — and it must not poison the new one', () => {
  /** A recipe list including one built on the user's own base, so a test can
   *  check what "yours" was resolved against. */
  const WITH_OWN = [
    ...RECIPES.slice(0, 4),
    { base: 'yours', palette: ['#ff9a4d', '#4b2a7a'], mood: ['dreamy'], name: 'yours, warmer' },
  ]

  it('a hover during the re-roll’s recipe call does not become the baseline', async () => {
    // `ask` is safe because it empties the strip first; `moreDirections` is not
    // — the old tiles stay hoverable right through the recipe call and the
    // candidate renders. A hover landing in that window used to be captured as
    // "the user's design", and then restored onto forever after.
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    let recipeCalls = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/vibe-recipes')) {
        if (++recipeCalls === 2) await held   // hold only the RE-ROLL's call
        return { recipes: WITH_OWN }
      }
      if (String(url).includes('/api/vibe-pick')) return { picks: [{ index: 1 }, { index: 2 }, { index: 3 }, { index: 5 }] }
      throw new Error('direct path must not be used')
    })
    const { agent, state } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()
    const mine = JSON.stringify(state.config)

    const reroll = agent.moreDirections()
    await flush(6)
    // The old strip is still on screen and still interactive.
    expect(agent.takes.value.length).toBeGreaterThan(0)
    agent.previewTake(agent.takes.value[0])
    expect(JSON.stringify(state.config)).not.toBe(mine)

    release()
    await reroll
    await flush()

    agent.previewTake(null)
    expect(JSON.stringify(state.config)).toBe(mine)
    agent.dismissTakes()
    expect(JSON.stringify(state.config)).toBe(mine)
  })

  it('and the anchor tile and any "yours" recipe are built from the TRUE base', async () => {
    // `baseSnapshot` is read for both. Poisoned, the strip offers the user
    // variations of a tile they merely hovered, and calls one of them "yours".
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    let recipeCalls = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/vibe-recipes')) {
        if (++recipeCalls === 2) await held
        return { recipes: WITH_OWN }
      }
      // Numbered from 1, as the prompt presents them; 5 is the "yours" recipe.
      if (String(url).includes('/api/vibe-pick')) return { picks: [{ index: 5 }, { index: 1 }, { index: 2 }, { index: 3 }] }
      throw new Error('direct path must not be used')
    })
    const { agent, state } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()
    const trueMark = state.config.mark

    const reroll = agent.moreDirections()
    await flush(6)
    // A tile whose config is NOT the user's own — hovering the "yours" recipe
    // would leave the config unchanged and prove nothing.
    const foreign = (agent.takes.value as any[]).find(t => t.config.mark !== trueMark)!
    agent.previewTake(foreign)
    expect(state.config.mark, 'the hover must actually be live, or this proves nothing')
      .not.toBe(trueMark)
    release()
    await reroll                               // …while the new strip is built
    await flush()

    const own = (agent.takes.value as any[]).find(t => t.recipe?.base === 'yours')
    expect(own, 'the "yours" recipe should be on the strip').toBeTruthy()
    expect(own.config.mark).toBe(trueMark)
    expect(own.config.note).toBe('from yours')
  })
})


describe('a fallback is recorded as a fallback, not as a rejection', () => {
  it('logs action "fallback" with the reason when composing fails', async () => {
    // Counting these as dismissals would tell a taste analyst that people
    // rejected takes they were never shown.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/vibe-recipes')) throw Object.assign(new Error('nope'), { statusCode: 405 })
      return { takes: [
        { label: 'direct one', changes: [{ key: 'tint', value: 10 }], rationale: 'a' },
        { label: 'direct two', changes: [{ key: 'tint', value: 40 }], rationale: 'b' },
      ] }
    })
    const { agent } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()

    const ev = readTakeLog().find(e => e.action === 'fallback')!
    expect(ev, 'a fallback must be on the record').toBeTruthy()
    expect(ev.fallback).toContain('405')
    expect(readTakeLog().some(e => e.action === 'dismiss')).toBe(false)
    // …and it is loud, not quiet.
    expect(warn.mock.calls.flat().map(String).join(' ')).toContain('direct path')
    warn.mockRestore()
  })

  it('records the eye-pick being unavailable too, for symmetry', async () => {
    // Without it, "the eye-pick never runs" and "the eye-pick always agrees
    // with us" look identical in the data.
    wire('fail')
    const { agent } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()

    const ev = readTakeLog().find(e => e.action === 'fallback')!
    expect(ev).toBeTruthy()
    expect(ev.fallback).toMatch(/eye-pick/)
    // The strip itself is fine — four takes, chosen by us.
    expect(agent.takes.value).toHaveLength(4)
  })

  it('a healthy composed run logs no fallback at all', async () => {
    wire()
    const { agent } = makeComposeAgent()
    await agent.ask('a dreamy sunset')
    await flush()
    expect(readTakeLog().some(e => e.action === 'fallback')).toBe(false)
  })
})
