// @vitest-environment happy-dom
//
// Four Takes — the CLOSE path, pinned at the shell.
//
// Why this file exists: `StudioModalShell.vue` is where every studio's ✕ and
// Escape live, and it is the only place that can put a previewed take back
// BEFORE the surface saves (a surface saves inside its own close handler, so
// anything later persists the preview as if the user had pressed Keep). That
// ordering was provably untested — deleting the `abandonTakes()` call from the
// shell left the whole suite green. These specs assert the ORDER, not just that
// both things happened, and pin that a studio without a take session closes
// exactly as it always did.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'

/** The shape the shell actually reads off a `useStudioAgent` return. */
function takeAgent(calls: string[], over: Record<string, unknown> = {}) {
  return {
    busy: ref(false),
    error: ref(''),
    notice: ref(''),
    reviewing: ref(false),
    hasProposal: ref(false),
    review: ref(null),
    changes: ref([]),
    hovered: ref(null),
    ask: vi.fn(),
    // Take session — a strip is OPEN, with a take selected and previewing.
    hasTakes: ref(true),
    takes: ref([{ label: 'warmer', changes: [{ key: 'hue', value: 40 }], rationale: '' }]),
    takeThumbs: ref(new Map()),
    takeCurrentThumb: ref(null),
    selectedTake: ref(null),
    canVaryTake: ref(false),
    previewTake: vi.fn(),
    selectTake: vi.fn(),
    keepTake: vi.fn(),
    dismissTakes: vi.fn(),
    abandonTakes: vi.fn(() => { calls.push('abandon') }),
    moreDirections: vi.fn(),
    variationsOfTake: vi.fn(),
    ...over,
  }
}

/** Texture's agent: the same chrome, no take session at all. */
function structuralAgent(calls: string[]) {
  const a = takeAgent(calls)
  delete (a as Record<string, unknown>).hasTakes
  delete (a as Record<string, unknown>).abandonTakes
  return a
}

function mountShell(agent: unknown, calls: string[], slots: Record<string, string> = {}) {
  return mount(StudioModalShell, {
    props: { title: 'Test studio', agent },
    attrs: { onClose: () => calls.push('surface-close') },
    slots: { preview: '<div>preview</div>', ...slots },
    global: { stubs: { AgentBar: true, AgentProgress: true, AgentProposal: true } },
  })
}

const closeBtn = (w: any) => w.get('button[aria-label="Close"]')
const pressEscape = async (w: any) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  await w.vm.$nextTick()
}

describe('StudioModalShell — closing with a take strip open', () => {
  it('✕ restores the original BEFORE the surface is told to close', async () => {
    const calls: string[] = []
    const w = mountShell(takeAgent(calls), calls)
    await closeBtn(w).trigger('click')
    // The order is the whole point: a surface saves in its close handler.
    expect(calls).toEqual(['abandon', 'surface-close'])
  })

  it('Escape does the same, in the same order', async () => {
    const calls: string[] = []
    const w = mountShell(takeAgent(calls), calls)
    await pressEscape(w)
    expect(calls).toEqual(['abandon', 'surface-close'])
  })

  it('closes exactly once per press', async () => {
    const calls: string[] = []
    const w = mountShell(takeAgent(calls), calls)
    await closeBtn(w).trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('mounts the strip for a take-capable agent, and only then', () => {
    const calls: string[] = []
    expect(mountShell(takeAgent(calls), calls).find('[data-testid="take-strip"]').exists()).toBe(true)
    const quiet = takeAgent(calls, { hasTakes: ref(false) })
    expect(mountShell(quiet, calls).find('[data-testid="take-strip"]').exists()).toBe(false)
  })
})

describe('StudioModalShell — studios without a take session are untouched', () => {
  it('Texture (structural agent, no take session) closes byte-identically on ✕', async () => {
    const calls: string[] = []
    const w = mountShell(structuralAgent(calls), calls)
    expect(w.find('[data-testid="take-strip"]').exists()).toBe(false)
    await closeBtn(w).trigger('click')
    expect(calls).toEqual(['surface-close'])
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Texture closes byte-identically on Escape', async () => {
    const calls: string[] = []
    const w = mountShell(structuralAgent(calls), calls)
    await pressEscape(w)
    expect(calls).toEqual(['surface-close'])
  })

  it('Space Type (no `agent` at all, own #agentBar) closes byte-identically', async () => {
    const calls: string[] = []
    const w = mount(StudioModalShell, {
      props: { title: 'Expressive Studio' },
      attrs: { onClose: () => calls.push('surface-close') },
      slots: { preview: '<div>preview</div>', agentBar: '<div data-testid="own-bar" />' },
    })
    expect(w.find('[data-testid="own-bar"]').exists()).toBe(true)
    expect(w.find('[data-testid="take-strip"]').exists()).toBe(false)
    await closeBtn(w).trigger('click')
    await pressEscape(w)
    expect(calls).toEqual(['surface-close', 'surface-close'])
  })
})
