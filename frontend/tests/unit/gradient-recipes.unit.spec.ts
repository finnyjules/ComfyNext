// Compose-and-pick: the deterministic core.
//
// This is where Julien's objection lives — "the model doesn't know how to
// translate an idea into our gradient machinery" — and the answer is that
// nothing here asks it to. A recipe is four choices from menus WE wrote, and
// turning one into a config is ordinary code with no model in it. So these specs
// are about exactly that: a recipe cannot name a control key, cannot reach a key
// we did not offer, and cannot produce a config we could not have produced.
import { describe, it, expect } from 'vitest'
import {
  MOOD_DIALS,
  MOOD_NAMES,
  OWN_BASE,
  RECIPES_SCHEMA,
  buildRecipesPrompt,
  materializeRecipe,
  salvageRecipes,
  summarizeConfig,
} from '~/lib/gradientfx/recipes'
import {
  ALL_LOOK_NAMES,
  DRIFT_TOLERANCE,
  LOOK_DESCRIPTORS,
  LOOK_NAMES,
  TAKE_BASE_LAYOUTS,
  TAKE_BASE_LAYOUT_FAMILIES,
  checkLookDrift,
  describeLook,
  isTakeBaseEligible,
  lookMenu,
} from '~/lib/gradientfx/lookDescriptors'
import { buildGradientPreset } from '~/lib/gradientfx/presets'
import { AUTHORED_PRESETS } from '~/lib/gradientfx/presetConfigs'
import { GRADIENT_PRESET_NAMES } from '~/lib/gradientfx/presets'
import { cloneConfig, type GradientConfig } from '~/lib/gradientfx/types'
import { defaultConfig } from '~/lib/gradientfx/randomize'
import { gradientAgentControls } from '~/lib/gradientfx/agentControls'

const own = () => defaultConfig('#own') as GradientConfig
const recipe = (over: Partial<any> = {}) => ({
  base: 'sunset', palette: ['#ff9a4d', '#d94f9c', '#4b2a7a'], mood: [], name: 'dusk', ...over,
})

describe('the look menu describes every preset we offer', () => {
  it('describes every preset the studio offers, and invents none', () => {
    // The DESCRIPTOR table still covers all of them — they are all reachable by
    // hand, and the drift guard still checks every one. What narrowed is the
    // agent's menu, below.
    expect([...ALL_LOOK_NAMES].sort()).toEqual([...GRADIENT_PRESET_NAMES].sort())
  })

  it('reads as a menu a person could use', () => {
    const line = describeLook('sunset')!
    expect(line).toContain('sunset')
    expect(line.toLowerCase()).toContain('vertical')
    expect(line).toMatch(/magenta|yellow|orange/)
    expect(lookMenu().split('\n')).toHaveLength(LOOK_NAMES.length)
  })

  it('never claims a colour the checker cannot measure', async () => {
    const { MEASURABLE_COLORS } = await import('~/lib/agent/takes')
    for (const [name, d] of Object.entries(LOOK_DESCRIPTORS)) {
      for (const c of d.colors) expect(MEASURABLE_COLORS, `${name}/${c}`).toContain(c)
    }
  })

  it('the drift guard still covers EVERY preset, menu or not', () => {
    // Narrowing the agent's menu must not narrow the studio's guarantees.
    for (const name of ALL_LOOK_NAMES) {
      const d = LOOK_DESCRIPTORS[name]!
      expect(checkLookDrift(name, { colors: [...d.colors], direction: d.direction, tone: d.tone, busy: d.busy }), name)
        .toEqual([])
    }
  })

  it('the mood sentence never contradicts the measured tone', () => {
    // The one human field, held to the numbers beside it: a descriptor cannot
    // call a light preset dark, however nice the sentence sounds.
    for (const [name, d] of Object.entries(LOOK_DESCRIPTORS)) {
      const m = d.mood.toLowerCase()
      if (/\bdark\b/.test(m)) expect(d.tone, name).toBe('dark')
      if (/\bbright\b|\bpale\b/.test(m)) expect(d.tone, name).not.toBe('dark')
      if (/\bbusy\b|turbulent/.test(m)) expect(d.busy, name).toBeGreaterThan(15)
      if (/\bsmooth\b|almost no detail/.test(m)) expect(d.busy, name).toBeLessThan(5)
    }
  })

  it('records a direction the checker can actually return', () => {
    for (const [name, d] of Object.entries(LOOK_DESCRIPTORS)) {
      expect(['vertical', 'horizontal', 'radial', 'none'], name).toContain(d.direction)
    }
  })
})

describe('mood dials are OURS, and only touch keys the studio offers', () => {
  it('every dial writes keys the gradient vocabulary actually has', () => {
    // The whole safety argument: the model picks an adjective, we pick the keys,
    // so a mood can never reach a key that does not exist.
    const offered = new Set<string>()
    for (const layout of ['linear', 'radial', 'orbit', 'liquid', 'mesh', 'ramp'] as const) {
      const cfg: any = defaultConfig('#p')
      cfg.canvas.layout = layout
      for (const c of gradientAgentControls(cfg, { includePreset: true })) offered.add(c.key)
    }
    for (const [mood, dial] of Object.entries(MOOD_DIALS)) {
      for (const key of Object.keys(dial)) expect(offered, `${mood}/${key}`).toContain(key)
    }
  })

  it('is a small, human-sized menu', () => {
    expect(MOOD_NAMES.length).toBeGreaterThanOrEqual(6)
    expect(MOOD_NAMES.length).toBeLessThanOrEqual(12)
  })
})

describe('RECIPES_SCHEMA', () => {
  it('asks for a base, a palette, moods and a name — and nothing else', () => {
    const item = (RECIPES_SCHEMA as any).properties.recipes.items
    expect(Object.keys(item.properties).sort()).toEqual(['base', 'mood', 'name', 'palette'])
    expect(item.additionalProperties).toBe(false)
  })

  it('carries no keyword structured outputs rejects', () => {
    const banned = ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'allOf', '$ref']
    const found: string[] = []
    const walk = (n: unknown, p: string) => {
      if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${p}[${i}]`))
      if (!n || typeof n !== 'object') return
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (banned.includes(k)) found.push(`${p}.${k}`)
        walk(v, `${p}.${k}`)
      }
    }
    walk(RECIPES_SCHEMA, 'RECIPES_SCHEMA')
    expect(found).toEqual([])
  })
})

describe('buildRecipesPrompt', () => {
  const p = buildRecipesPrompt('a dreamy sunset', { base: 'ramp', palette: ['#112233', '#445566'] })

  it('shows the ask, both menus, and what the user already has', () => {
    expect(p).toContain('a dreamy sunset')
    expect(p).toContain('sunset —')       // the look menu
    expect(p).toContain('dreamy')          // the mood menu
    expect(p).toContain('#112233')         // yours
  })

  it('never mentions a control key — that is the point of the redesign', () => {
    expect(p).not.toMatch(/layer\.color\.stops|flow\.|focus\.|post\./)
  })

  it('asks for variety of BASE, not just of colour', () => {
    expect(p.toLowerCase()).toMatch(/vary the base|not only the colours/)
  })
})

describe('salvageRecipes — a bad entry costs that entry, nothing more', () => {
  const wrap = (...recipes: unknown[]) => ({ recipes })

  it('keeps well-formed recipes', () => {
    const out = salvageRecipes(wrap(recipe(), recipe({ base: OWN_BASE, name: 'yours, warmer' })))
    expect(out).toHaveLength(2)
    expect(out[1]!.base).toBe(OWN_BASE)
  })

  it('drops a base that is not on the menu, and keeps the others', () => {
    const out = salvageRecipes(wrap(recipe({ base: 'not-a-look' }), recipe()))
    expect(out).toHaveLength(1)
    expect(out[0]!.base).toBe('sunset')
  })

  it('drops a recipe whose palette is not an ordering', () => {
    expect(salvageRecipes(wrap(recipe({ palette: ['#ff0000'] })))).toEqual([])
    expect(salvageRecipes(wrap(recipe({ palette: ['red', 'blue'] })))).toEqual([])
    expect(salvageRecipes(wrap(recipe({ palette: 'nope' })))).toEqual([])
  })

  it('drops an off-menu MOOD silently, keeping the recipe', () => {
    // A recipe with a good base and good colours is still good with one
    // adjective missing — losing the whole reading over it would be the
    // over-refusal this codebase keeps having to unlearn.
    const out = salvageRecipes(wrap(recipe({ mood: ['dreamy', 'zesty', 'calm'] })))
    expect(out[0]!.mood).toEqual(['dreamy', 'calm'])
  })

  it('normalises case and trims, so "Sunset" is not a different look', () => {
    const out = salvageRecipes(wrap(recipe({ base: ' Sunset ', palette: ['#FF9A4D', '#4B2A7A'], mood: [' Dreamy '] })))
    expect(out[0]).toMatchObject({ base: 'sunset', mood: ['dreamy'] })
    expect(out[0]!.palette).toEqual(['#ff9a4d', '#4b2a7a'])
  })

  it('caps the batch, the palette and the moods', () => {
    expect(salvageRecipes(wrap(...Array(20).fill(recipe())))).toHaveLength(8)
    const big = salvageRecipes(wrap(recipe({
      palette: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'],
      mood: MOOD_NAMES,
    })))
    expect(big[0]!.palette).toHaveLength(5)
    expect(big[0]!.mood).toHaveLength(3)
  })

  it('anything unreadable is an empty batch, never a throw', () => {
    for (const bad of [null, undefined, 7, 'recipes', {}, { recipes: 'no' }, { recipes: [null, 3] }]) {
      expect(salvageRecipes(bad)).toEqual([])
    }
  })

  it('falls back to the base name when the name is unusable', () => {
    expect(salvageRecipes(wrap(recipe({ name: '   ' })))[0]!.name).toBe('sunset')
  })
})

describe('materializeRecipe — our code does the translating', () => {
  it('builds the named base look', () => {
    const cfg = materializeRecipe(recipe(), own(), cloneConfig, '#seed')!
    expect(cfg.canvas.layout).toBe(LOOK_DESCRIPTORS.sunset ? cfg.canvas.layout : cfg.canvas.layout)
    // The sunset preset's own layout, not the user's default ramp.
    expect(cfg.canvas.layout).not.toBe(own().canvas.layout)
  })

  it('"yours" keeps the user\'s base, and does not mutate it', () => {
    const mine = own()
    const before = JSON.stringify(mine)
    const cfg = materializeRecipe(recipe({ base: OWN_BASE }), mine, cloneConfig, '#seed')!
    expect(cfg.canvas.layout).toBe(mine.canvas.layout)
    expect(JSON.stringify(mine)).toBe(before)
  })

  it('lays the palette across the base\'s OWN stops, in order', () => {
    const cfg = materializeRecipe(recipe(), own(), cloneConfig, '#seed')!
    const stops = cfg.layers[0]!.color.stops.map(s => s.color)
    expect(stops[0]).toBe('#ff9a4d')                     // first colour at the start
    expect(stops[stops.length - 1]).toBe('#4b2a7a')      // last at the end
    for (const c of stops) expect(recipe().palette).toContain(c)
  })

  it('recolours the stops the base has rather than growing the ramp', () => {
    const base = materializeRecipe(recipe({ palette: ['#111111', '#222222'] }), own(), cloneConfig, '#s')!
    const plain = materializeRecipe(recipe({ palette: ['#111111', '#222222', '#333333', '#444444', '#555555'] }), own(), cloneConfig, '#s')!
    expect(base.layers[0]!.color.stops).toHaveLength(plain.layers[0]!.color.stops.length)
  })

  it('applies the mood dials, last, so a mood can override the base', () => {
    const plain = materializeRecipe(recipe(), own(), cloneConfig, '#seed')!
    const dreamy = materializeRecipe(recipe({ mood: ['dreamy'] }), own(), cloneConfig, '#seed')!
    expect(dreamy.focus.blur).toBe(MOOD_DIALS.dreamy!['focus.blur'])
    expect(dreamy.focus.blur).not.toBe(plain.focus.blur)
    expect(dreamy.post.grain).toBe(true)
  })

  it('is deterministic — the same recipe and seed give the same config', () => {
    const a = materializeRecipe(recipe({ mood: ['dreamy', 'moody'] }), own(), cloneConfig, '#same')
    const b = materializeRecipe(recipe({ mood: ['dreamy', 'moody'] }), own(), cloneConfig, '#same')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('never returns null for a recipe salvage approved', () => {
    for (const base of [...LOOK_NAMES, OWN_BASE]) {
      const [r] = salvageRecipes({ recipes: [recipe({ base })] })
      expect(materializeRecipe(r!, own(), cloneConfig, '#s'), base).toBeTruthy()
    }
  })
})

describe('summarizeConfig — what "yours" means in the prompt', () => {
  it('reads the layout and the ramp colours back out', () => {
    const s = summarizeConfig(own())
    expect(s.base).toBe(own().canvas.layout)
    expect(s.palette.length).toBeGreaterThan(0)
    for (const c of s.palette) expect(c).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('survives a config with nothing in it', () => {
    expect(summarizeConfig({} as GradientConfig)).toEqual({ base: 'unknown', palette: [] })
  })
})


describe('the drift guard — a descriptor that stops telling the truth', () => {
  const asMeasured = (name: string) => {
    const d = LOOK_DESCRIPTORS[name]!
    return { colors: [...d.colors], direction: d.direction, tone: d.tone, busy: d.busy }
  }

  it('every recorded descriptor passes against its own recorded numbers', () => {
    for (const name of LOOK_NAMES) expect(checkLookDrift(name, asMeasured(name)), name).toEqual([])
  })

  it('catches a direction that flipped — the claim the recipe call reasons about', () => {
    const m = { ...asMeasured('sunset'), direction: 'horizontal' }
    expect(checkLookDrift('sunset', m).join(' ')).toContain('direction')
  })

  it('catches a tone that inverted', () => {
    expect(checkLookDrift('aurora', { ...asMeasured('aurora'), tone: 'light' }).join(' ')).toContain('tone')
  })

  it('catches a palette that walked away entirely', () => {
    expect(checkLookDrift('lava', { ...asMeasured('lava'), colors: ['blue', 'teal'] }).join(' ')).toContain('colours')
  })

  it('tolerates a re-seed reordering the palette, as long as one colour survives', () => {
    const d = LOOK_DESCRIPTORS.lava!
    expect(checkLookDrift('lava', { ...asMeasured('lava'), colors: ['grey', d.colors[1]!] })).toEqual([])
  })

  it('gives busyness a proportional band, not an exact match', () => {
    const d = LOOK_DESCRIPTORS.ink!
    expect(checkLookDrift('ink', { ...asMeasured('ink'), busy: d.busy * (1 + DRIFT_TOLERANCE.busy * 0.9) })).toEqual([])
    expect(checkLookDrift('ink', { ...asMeasured('ink'), busy: d.busy * 3 }).join(' ')).toContain('busy')
  })

  it('a smooth look cannot drift into a busy one unnoticed', () => {
    // `mesh` measured 1.4 — the proportional band would be tiny, so the floor
    // keeps the guard from firing on ordinary noise while still catching this.
    expect(checkLookDrift('mesh', { ...asMeasured('mesh'), busy: 20 }).join(' ')).toContain('busy')
  })

  it('an unknown look is drift, not a pass', () => {
    expect(checkLookDrift('nope', asMeasured('sunset'))).toEqual(['unknown look'])
  })
})


describe('the recipe menu only offers the versatile layout families', () => {
  // Julien's call after the first real-model runs: conic, stripe, orbit and
  // stack looks are "too specific and never really fit the vision". Measured
  // 2026-08-26 from `buildGradientPreset(name, '#menu').canvas.layout`.
  const MEASURED: Record<string, string> = {
    marble: 'liquid', oil: 'liquid', ink: 'liquid', lava: 'liquid', satin: 'liquid',
    liquid: 'liquid', aurora: 'liquid', frosted: 'liquid', sunset: 'liquid',
    mesh: 'mesh', dawn: 'ramp', halo: 'radialRamp',
    ripple: 'orbit', stack: 'stack', linear: 'linear', spectrum: 'conic',
  }

  it('each preset still builds the layout the gate was measured against', () => {
    // If this drifts, the in/out table below is describing a catalog we no
    // longer have — and the gate would be silently offering something else.
    for (const [name, layout] of Object.entries(MEASURED)) {
      expect(buildGradientPreset(name, '#menu')?.canvas.layout, name).toBe(layout)
    }
  })

  it('offers no preset whose measured layout is outside the families', () => {
    for (const name of LOOK_NAMES) {
      expect(TAKE_BASE_LAYOUTS, name).toContain(buildGradientPreset(name, '#menu')!.canvas.layout)
    }
  })

  it('withholds exactly the four the catalog has today', () => {
    const withheld = ALL_LOOK_NAMES.filter(n => !LOOK_NAMES.includes(n)).sort()
    expect(withheld).toEqual(['linear', 'ripple', 'spectrum', 'stack'])
  })

  it('keeps the looks people actually ask for', () => {
    for (const n of ['dawn', 'halo', 'aurora', 'frosted', 'sunset', 'marble', 'mesh']) {
      expect(LOOK_NAMES, n).toContain(n)
    }
  })

  it('the families cover the five Julien named, and nothing else', () => {
    expect(Object.keys(TAKE_BASE_LAYOUT_FAMILIES).sort())
      .toEqual(['CURVE', 'LINEAR', 'LIQUID', 'MESH', 'RADIAL'])
    for (const bad of ['conic', 'orbit', 'stack', 'linear', 'radial']) {
      expect(TAKE_BASE_LAYOUTS, bad).not.toContain(bad)
    }
  })

  it('DERIVES the gate — a preset invented at runtime is judged, not looked up', () => {
    // The real derive-don't-enumerate control. A hand-typed exclusion list would
    // give identical answers for today's catalog, so the only way to tell the
    // two apart is to introduce a preset no list has ever heard of and check the
    // gate still gets it right — from the config it builds, and nothing else.
    const authored = AUTHORED_PRESETS as Record<string, unknown>
    const base = buildGradientPreset('dawn', '#menu')!   // an OFFERED family (ramp)
    const conic = buildGradientPreset('spectrum', '#menu')!
    try {
      authored['brand-new-ramp'] = JSON.parse(JSON.stringify(base))
      authored['brand-new-conic'] = JSON.parse(JSON.stringify(conic))
      expect(isTakeBaseEligible('brand-new-ramp'), 'admitted with no edit to the gate').toBe(true)
      expect(isTakeBaseEligible('brand-new-conic'), 'withheld with no edit to the gate').toBe(false)
    } finally {
      delete authored['brand-new-ramp']
      delete authored['brand-new-conic']
    }
    expect(isTakeBaseEligible('halo')).toBe(true)      // radialRamp
    expect(isTakeBaseEligible('spectrum')).toBe(false) // conic
    expect(isTakeBaseEligible('not-a-preset')).toBe(false)
  })

  it('the menu prose the model sees carries only offered looks', () => {
    const menu = lookMenu()
    for (const n of LOOK_NAMES) expect(menu, n).toContain(`${n} —`)
    for (const n of ['spectrum', 'stack', 'ripple']) expect(menu, n).not.toContain(`${n} —`)
  })
})

describe('salvage drops a recipe naming a withheld base', () => {
  const wrapOne = (base: string) => ({ recipes: [
    { base, palette: ['#ff9a4d', '#4b2a7a'], mood: [], name: 'x' },
    { base: 'sunset', palette: ['#ff9a4d', '#4b2a7a'], mood: [], name: 'ok' },
  ] })

  it('a conic/stripe/orbit/stack base is dropped like any unknown one', () => {
    for (const base of ['spectrum', 'stack', 'ripple', 'linear']) {
      const out = salvageRecipes(wrapOne(base))
      expect(out.map(r => r.base), base).toEqual(['sunset'])
    }
  })

  it('and "yours" is always allowed, whatever the user\u2019s own layout is', () => {
    // It is their design; the menu narrows what we OFFER, not what they have.
    expect(salvageRecipes(wrapOne(OWN_BASE)).map(r => r.base)).toEqual([OWN_BASE, 'sunset'])
  })
})
