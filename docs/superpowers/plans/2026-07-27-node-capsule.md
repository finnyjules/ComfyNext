# Node Capsule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give canvas nodes a collapsed 40px resting state — icon, name, one-line read-out, run button — that expands back to the full card in place on click.

**Architecture:** Pure logic lands first as standalone TypeScript modules under `app/lib/canvas/` with vitest coverage (read-out resolution, elapsed formatting, capsule metadata, icon resolution). The Vue component consumes those modules and is verified with Playwright. Nothing in `ComfyNode.vue` changes until the modules it depends on exist and are green.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript / Tailwind. Unit tests: vitest (`tests/unit/**/*.unit.spec.ts`, node environment). E2E: Playwright (`tests/*.spec.ts`).

Design spec: [2026-07-27-node-capsule-design.md](../specs/2026-07-27-node-capsule-design.md)

## Global Constraints

- **Colour tokens only.** `--action` (`oklch(0.574 0.234 260.696)`) for run/running/re-run. `--palette-coral` (`oklch(0.697 0.193 26.566)`) for stop and failure. Never purple. Never emerald for run.
- **Coral is a filled glyph on a neutral chip**, never a solid red button — matches `app/layouts/default.vue:4224-4228`.
- **The icon tile is neutral** — `background: rgba(255,255,255,.07)`, glyph `rgba(255,255,255,.72)`. No type tint.
- **The read-out is a summary, never a control.** No inputs, sliders, or editable fields on a capsule.
- **The running border sweep keeps its type-colour gradient** (`--border-left` / `--border-right`). This is the one sanctioned place type colour survives.
- **Sweep duration on a capsule is `2.4s`**, not the card's `2s`.
- **The capsule needs `isolation: isolate`** or the sweep silently vanishes.
- **Do not modify `GRADIENT_CONTROLS` keys** — `app/lib/gradientfx/controls.ts:5-24` declares them frozen; persisted Collection bindings are `params.<key>`.
- **`nodeTypes` in `VueNodeCanvas.vue:244-263` must stay hoisted and `markRaw`'d.** A new object reference remounts every node.
- **Commit hygiene:** this repo runs parallel sessions. Every commit step lists explicit paths. Never `git add -A`, never `git stash`.
- Unit tests run with `npm run test:unit` from `frontend/`. E2E with `npm test`.

---

### Task 1: Elapsed-time foundation

Per-node elapsed time does not exist today — only per-run (`app/lib/graph/runRegistry.ts:17`). The only formatter is trapped inside `CanvasStatusBar.vue`. Extract it, then stamp a per-node timestamp.

**Files:**
- Create: `frontend/app/lib/canvas/elapsed.ts`
- Create: `frontend/tests/unit/capsule-elapsed.unit.spec.ts`
- Modify: `frontend/app/components/CanvasStatusBar.vue:59-69`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue:2685` (executing), `:2831` (complete), `:2788` (error)

**Interfaces:**
- Consumes: nothing
- Produces: `fmtSec(s: number): string`, `elapsedSince(startedAt: number | null | undefined, now: number): number`, and two new `node.data` fields: `runningSince?: number | null` and `hasRun?: boolean`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/capsule-elapsed.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fmtSec, elapsedSince } from '~/lib/canvas/elapsed'

describe('fmtSec', () => {
  it('shows one decimal under ten seconds', () => {
    expect(fmtSec(0)).toBe('0.0s')
    expect(fmtSec(8.44)).toBe('8.4s')
    expect(fmtSec(9.99)).toBe('10.0s')
  })

  it('rounds to whole seconds from ten to sixty', () => {
    expect(fmtSec(10)).toBe('10s')
    expect(fmtSec(42.4)).toBe('42s')
  })

  it('switches to minutes at sixty seconds', () => {
    expect(fmtSec(60)).toBe('1m 0s')
    expect(fmtSec(72)).toBe('1m 12s')
    expect(fmtSec(3600)).toBe('60m 0s')
  })

  // Documents existing CanvasStatusBar behaviour, carried over deliberately:
  // 59.6s rounds to "60s" rather than "1m 0s". Do not "fix" this here — the
  // status bar and the capsule must agree, and changing it is a separate call.
  it('keeps the inherited rounding seam at 59.5s', () => {
    expect(fmtSec(59.6)).toBe('60s')
  })
})

describe('elapsedSince', () => {
  it('returns zero for a missing start', () => {
    expect(elapsedSince(null, 1000)).toBe(0)
    expect(elapsedSince(undefined, 1000)).toBe(0)
    expect(elapsedSince(0, 1000)).toBe(0)
  })

  it('returns seconds between the stamps', () => {
    expect(elapsedSince(1_000, 13_500)).toBe(12.5)
  })

  it('never returns negative for a clock that went backwards', () => {
    expect(elapsedSince(5_000, 1_000)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/capsule-elapsed.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "~/lib/canvas/elapsed"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/canvas/elapsed.ts`:

```ts
// Elapsed-time formatting shared by the run status bar and the node capsule
// read-out. Extracted verbatim from CanvasStatusBar.vue so both surfaces
// describe time identically — a capsule reading "1m 12s" while the status bar
// reads "72s" for the same run is the kind of drift that erodes trust in both.

/** Format a duration in seconds: "8.4s" / "42s" / "1m 12s". */
export function fmtSec(s: number): string {
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s - m * 60)
  return `${m}m ${rest}s`
}

/** Seconds between a start stamp and now. Zero when unstarted or if the clock
 *  moved backwards (system sleep, NTP correction). */
export function elapsedSince(startedAt: number | null | undefined, now: number): number {
  if (!startedAt) return 0
  return Math.max(0, (now - startedAt) / 1000)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/capsule-elapsed.unit.spec.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Point CanvasStatusBar at the shared module**

In `frontend/app/components/CanvasStatusBar.vue`, delete the local `fmtSec` function (currently at `:63-69`) and replace the `elapsedSec` computed body. Add the import alongside the existing imports in the `<script setup>` block:

```ts
import { fmtSec, elapsedSince } from '~/lib/canvas/elapsed'
```

Replace:

```ts
const elapsedSec = computed(() => {
  if (!props.startedAt) return 0
  return Math.max(0, (now.value - props.startedAt) / 1000)
})

function fmtSec(s: number): string {
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s - m * 60)
  return `${m}m ${rest}s`
}
```

with:

```ts
const elapsedSec = computed(() => elapsedSince(props.startedAt, now.value))
```

- [ ] **Step 6: Stamp `runningSince` on the node**

In `frontend/app/components/vue-canvas/VueNodeCanvas.vue`, three edits.

At `:2685` (the `executing` branch), change:

```ts
          target.data = { ...target.data, running: true, error: false }
```

to:

```ts
          // runningSince powers the capsule read-out's live elapsed counter.
          // The run-level startedAt in runRegistry measures the whole run, not
          // this node, so a per-node stamp is the only way a capsule can say
          // how long IT has been going.
          target.data = { ...target.data, running: true, error: false, runningSince: Date.now() }
```

At `:2831` (the `execution_complete` branch), change:

```ts
        target.data = { ...target.data, running: false, progress: undefined }
```

to:

```ts
        target.data = { ...target.data, running: false, progress: undefined, runningSince: null, hasRun: true }
```

`hasRun` is what the `after-run` collapse tier keys off in Task 4 — "this node has produced something at least once". It is deliberately *not* cleared on error: a node that ran yesterday and failed today has still run.

At `:2788` (the `execution_error` branch), add `runningSince: null` to the object:

```ts
        target.data = {
          ...target.data,
          running: false,
          error: true,
          errorMessage: event.data.exception_message || null,
          runningSince: null,
        }
```

- [ ] **Step 7: Declare the field on the node props type**

In `frontend/app/components/vue-canvas/ComfyNode.vue`, in the props `data` type (around `:38-43`, beside `running?: boolean`), add:

```ts
  runningSince?: number | null
  hasRun?: boolean
```

- [ ] **Step 8: Verify nothing regressed**

Run: `cd frontend && npx vitest run`
Expected: PASS — the full unit suite, including the new file.

Run: `cd frontend && npx nuxi typecheck 2>&1 | tail -5`
Expected: error count at or below the ~328 baseline. If it rose, the delta is yours — fix it.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/lib/canvas/elapsed.ts \
        frontend/tests/unit/capsule-elapsed.unit.spec.ts \
        frontend/app/components/CanvasStatusBar.vue \
        frontend/app/components/vue-canvas/VueNodeCanvas.vue \
        frontend/app/components/vue-canvas/ComfyNode.vue
git commit -m "feat(capsule): per-node runningSince + shared elapsed formatting

Extracts fmtSec out of CanvasStatusBar so the capsule read-out and the
status bar describe time identically, and stamps a per-node runningSince
on the executing transition. Run-level startedAt measures the whole run,
which is not what a single capsule needs to report.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Read-out resolver — state precedence, widgets, text

The read-out answers *"what one fact belongs beside my name?"*. This task builds the pure resolver with three of its four sources. The `{from:'controls'}` branch lands in Task 3.

**Files:**
- Create: `frontend/app/lib/canvas/capsuleReadout.ts`
- Create: `frontend/tests/unit/capsule-readout.unit.spec.ts`

**Interfaces:**
- Consumes: `fmtSec`, `elapsedSince` from `~/lib/canvas/elapsed` (Task 1)
- Produces:
  - `type ReadoutPart = { name: string; prefix?: string; suffix?: string }`
  - `type ReadoutRule = { from: 'widgets'; parts: ReadoutPart[] } | { from: 'controls' } | { from: 'text'; property: string; max: number } | { from: 'none' }`
  - `interface ReadoutInput { … }` (full shape in Step 3)
  - `resolveReadout(input: ReadoutInput): string | null`
  - `formatReadoutValue(v: unknown): string | null`
  - `const READOUT_SEPARATOR = ' · '`, `const MAX_SUMMARY_PARTS = 2`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/capsule-readout.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveReadout, formatReadoutValue, READOUT_SEPARATOR } from '~/lib/canvas/capsuleReadout'

// Mirrors the real shape from useVueNodes.ts:441-443 — widgetDefs and
// widgetsValues are POSITIONAL and index-aligned, and getWidgetDefs injects a
// hidden "<name>_control" placeholder after seed widgets to keep them aligned.
const KSAMPLER_DEFS = [
  { name: 'seed', type: 'INT' },
  { name: 'seed_control', type: 'SEED_CONTROL', hidden: true },
  { name: 'steps', type: 'INT' },
  { name: 'cfg', type: 'FLOAT' },
  { name: 'sampler_name', type: 'COMBO' },
]
const KSAMPLER_VALUES = [84021, 'randomize', 28, 3.5, 'euler']

describe('formatReadoutValue', () => {
  it('passes strings through trimmed', () => {
    expect(formatReadoutValue('  euler ')).toBe('euler')
  })

  it('renders integers without decimals', () => {
    expect(formatReadoutValue(28)).toBe('28')
  })

  it('trims trailing zeros from floats', () => {
    expect(formatReadoutValue(3.5)).toBe('3.5')
    expect(formatReadoutValue(0.7200001)).toBe('0.72')
    expect(formatReadoutValue(2.0)).toBe('2')
  })

  it('renders booleans as on/off', () => {
    expect(formatReadoutValue(true)).toBe('on')
    expect(formatReadoutValue(false)).toBe('off')
  })

  it('rejects empties rather than rendering blanks', () => {
    expect(formatReadoutValue(null)).toBeNull()
    expect(formatReadoutValue(undefined)).toBeNull()
    expect(formatReadoutValue('')).toBeNull()
    expect(formatReadoutValue('   ')).toBeNull()
    expect(formatReadoutValue({})).toBeNull()
  })
})

describe('resolveReadout — state precedence', () => {
  const base = {
    rule: { from: 'widgets' as const, parts: [{ name: 'steps', suffix: ' steps' }] },
    widgetDefs: KSAMPLER_DEFS,
    widgetsValues: KSAMPLER_VALUES,
  }

  it('puts the error message above everything', () => {
    expect(resolveReadout({
      ...base,
      running: true,
      runningSince: 1_000,
      now: 13_000,
      errorMessage: 'No credits remaining',
    })).toBe('No credits remaining')
  })

  it('collapses whitespace and truncates a long error', () => {
    const long = 'Traceback:\n  something failed in a very long and unhelpful backend message here'
    const out = resolveReadout({ ...base, errorMessage: long })!
    expect(out).not.toContain('\n')
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('…')).toBe(true)
  })

  it('reports live elapsed while running', () => {
    expect(resolveReadout({ ...base, running: true, runningSince: 1_000, now: 13_500 }))
      // fmtSec rounds anything >= 10s to whole seconds, so 12.5 renders "13s".
      .toBe(`rendering${READOUT_SEPARATOR}13s`)
  })

  it('says rendering with no clock when the stamp is missing', () => {
    expect(resolveReadout({ ...base, running: true, runningSince: null, now: 13_500 }))
      .toBe('rendering')
  })

  it('falls back to the declared rule when idle', () => {
    expect(resolveReadout(base)).toBe('28 steps')
  })
})

describe('resolveReadout — widgets rule', () => {
  it('resolves by name across the hidden seed placeholder', () => {
    // cfg is at index 3; a naive positional read that ignored seed_control
    // would return 28 here. This is the regression this test exists for.
    expect(resolveReadout({
      rule: { from: 'widgets', parts: [{ name: 'cfg', prefix: 'guidance ' }] },
      widgetDefs: KSAMPLER_DEFS,
      widgetsValues: KSAMPLER_VALUES,
    })).toBe('guidance 3.5')
  })

  it('joins parts with the separator', () => {
    expect(resolveReadout({
      rule: { from: 'widgets', parts: [
        { name: 'steps', suffix: ' steps' },
        { name: 'cfg', prefix: 'guidance ' },
      ] },
      widgetDefs: KSAMPLER_DEFS,
      widgetsValues: KSAMPLER_VALUES,
    })).toBe(`28 steps${READOUT_SEPARATOR}guidance 3.5`)
  })

  it('caps at two parts even when more are declared', () => {
    const out = resolveReadout({
      rule: { from: 'widgets', parts: [
        { name: 'steps' }, { name: 'cfg' }, { name: 'sampler_name' },
      ] },
      widgetDefs: KSAMPLER_DEFS,
      widgetsValues: KSAMPLER_VALUES,
    })!
    expect(out.split(READOUT_SEPARATOR)).toHaveLength(2)
  })

  it('skips missing widgets instead of rendering a gap', () => {
    expect(resolveReadout({
      rule: { from: 'widgets', parts: [{ name: 'nope' }, { name: 'steps', suffix: ' steps' }] },
      widgetDefs: KSAMPLER_DEFS,
      widgetsValues: KSAMPLER_VALUES,
    })).toBe('28 steps')
  })

  it('returns null when nothing resolved', () => {
    expect(resolveReadout({
      rule: { from: 'widgets', parts: [{ name: 'nope' }] },
      widgetDefs: KSAMPLER_DEFS,
      widgetsValues: KSAMPLER_VALUES,
    })).toBeNull()
  })

  it('survives absent arrays', () => {
    expect(resolveReadout({ rule: { from: 'widgets', parts: [{ name: 'steps' }] } })).toBeNull()
  })
})

describe('resolveReadout — text rule', () => {
  it('collapses whitespace and truncates with an ellipsis', () => {
    expect(resolveReadout({
      rule: { from: 'text', property: 'prompt', max: 24 },
      properties: { prompt: 'a lighthouse at dusk, long exposure, sea fog' },
    })).toBe('a lighthouse at dusk, l…')
  })

  it('leaves short text alone', () => {
    expect(resolveReadout({
      rule: { from: 'text', property: 'prompt', max: 40 },
      properties: { prompt: 'a lighthouse at dusk' },
    })).toBe('a lighthouse at dusk')
  })

  it('returns null for a missing or blank property', () => {
    expect(resolveReadout({ rule: { from: 'text', property: 'prompt', max: 40 }, properties: {} })).toBeNull()
    expect(resolveReadout({ rule: { from: 'text', property: 'p', max: 40 }, properties: { p: '   ' } })).toBeNull()
  })
})

describe('resolveReadout — degrade to silence', () => {
  it('returns null with no rule at all', () => {
    expect(resolveReadout({})).toBeNull()
  })

  it('returns null for an explicit none rule', () => {
    expect(resolveReadout({ rule: { from: 'none' } })).toBeNull()
  })

  it('never throws on an unknown rule shape', () => {
    expect(resolveReadout({ rule: { from: 'wat' } as any })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/capsule-readout.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "~/lib/canvas/capsuleReadout"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/canvas/capsuleReadout.ts`:

```ts
import { fmtSec, elapsedSince } from '~/lib/canvas/elapsed'

// The one line of text under a capsule's name. It does double duty: settings
// when the node is idle, status when it is not. That is what lets a capsule
// stay closed through an entire run-fail-retry cycle instead of forcing you to
// expand it to find out what happened after pressing play.
//
// The governing rule is DEGRADE TO SILENCE: a node with no declared rule shows
// its name and nothing else. Never guess, never dump raw widget values. That
// way partial coverage looks deliberate rather than broken, and read-out rules
// can land node type by node type without ever shipping a wrong-looking chip.

export const READOUT_SEPARATOR = ' · '
export const MAX_SUMMARY_PARTS = 2
const MAX_ERROR_CHARS = 60

/** One value pulled from a Comfy node's positional widget array, by name. */
export type ReadoutPart = { name: string; prefix?: string; suffix?: string }

export type ReadoutRule =
  /** Comfy nodes: no schema, so the widget names are declared as data. */
  | { from: 'widgets'; parts: ReadoutPart[] }
  /** Studio nodes: derived from ControlSpec entries carrying `summary`. */
  | { from: 'controls' }
  /** Prompt-ish nodes: one long string, truncated. */
  | { from: 'text'; property: string; max: number }
  | { from: 'none' }

export interface WidgetDef { name: string; type?: string; hidden?: boolean }

export interface ReadoutInput {
  rule?: ReadoutRule
  /** Index-aligned with widgetsValues — see useVueNodes.ts:103-148. */
  widgetDefs?: WidgetDef[]
  widgetsValues?: unknown[]
  /** node.data.properties */
  properties?: Record<string, unknown>
  /** Run state, straight off node.data. */
  running?: boolean
  runningSince?: number | null
  errorMessage?: string | null
  /** Injected for testability; defaults to the wall clock. */
  now?: number
}

/** Render a raw value for display, or null if it has nothing to say. */
export function formatReadoutValue(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    // Two decimals max, trailing zeros stripped: 3.5 → "3.5", 2.0 → "2".
    return String(Math.round(v * 100) / 100)
  }
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length ? t : null
  }
  return null
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`
}

function fromWidgets(parts: ReadoutPart[], defs: WidgetDef[], values: unknown[]): string[] {
  const out: string[] = []
  for (const part of parts) {
    if (out.length >= MAX_SUMMARY_PARTS) break
    // Resolve by NAME, not position. getWidgetDefs injects a hidden
    // "<name>_control" placeholder after seed widgets purely to keep the two
    // arrays aligned, so any positional assumption here is wrong by one.
    const idx = defs.findIndex(d => d.name === part.name)
    if (idx < 0) continue
    const shown = formatReadoutValue(values[idx])
    if (shown === null) continue
    out.push(`${part.prefix ?? ''}${shown}${part.suffix ?? ''}`)
  }
  return out
}

export function resolveReadout(input: ReadoutInput): string | null {
  // 1. Failure wins. It is the only thing you need to know.
  if (input.errorMessage) {
    const msg = collapse(String(input.errorMessage))
    if (msg) return truncate(msg, MAX_ERROR_CHARS)
  }

  // 2. Running. Live elapsed if we stamped a start, bare word if we did not.
  if (input.running) {
    const started = input.runningSince
    if (!started) return 'rendering'
    const now = input.now ?? Date.now()
    return `rendering${READOUT_SEPARATOR}${fmtSec(elapsedSince(started, now))}`
  }

  // 3. The declared rule.
  const rule = input.rule
  if (!rule) return null

  if (rule.from === 'widgets') {
    const parts = fromWidgets(rule.parts ?? [], input.widgetDefs ?? [], input.widgetsValues ?? [])
    return parts.length ? parts.join(READOUT_SEPARATOR) : null
  }

  if (rule.from === 'text') {
    const raw = input.properties?.[rule.property]
    const shown = formatReadoutValue(raw)
    if (shown === null) return null
    return truncate(collapse(shown), rule.max)
  }

  // 'controls' is wired in Task 3; 'none' and anything unrecognised fall
  // through to silence rather than throwing.
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/capsule-readout.unit.spec.ts`
Expected: PASS — 22 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/canvas/capsuleReadout.ts \
        frontend/tests/unit/capsule-readout.unit.spec.ts
git commit -m "feat(capsule): read-out resolver with state precedence

Resolution order is error > running > declared rule > silence. Widget
lookup is by name, not position — getWidgetDefs injects a hidden
seed_control placeholder that makes every positional assumption wrong
by one.

Degrades to silence so read-out coverage can land node type by node
type without ever shipping a wrong-looking capsule.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: `summary` on the control schema

Studio nodes already declare their parameters. Add one opt-in field beside the existing `agent?` and `animatable?` flags, and derive the read-out from it — one declaration per surface rather than a hand-written string.

**Files:**
- Modify: `frontend/app/lib/spacetype/effect.ts:12-31` (`ControlMeta`)
- Modify: `frontend/app/lib/gradientfx/controls.ts` (declare `summary` on two controls)
- Modify: `frontend/app/lib/canvas/capsuleReadout.ts`
- Modify: `frontend/tests/unit/capsule-readout.unit.spec.ts`

**Interfaces:**
- Consumes: `ControlSpec` from `~/lib/spacetype/effect`, `resolveReadout` from Task 2
- Produces: `ControlMeta.summary?: number`; `ReadoutInput` gains `controls?: ControlSpec[]` and `config?: Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/unit/capsule-readout.unit.spec.ts`:

```ts
import type { ControlSpec } from '~/lib/spacetype/effect'

const GRADIENT_CONTROLS_SAMPLE: ControlSpec[] = [
  { key: 'preset', label: 'Preset', kind: 'select', options: ['aurora', 'dusk'], default: 'aurora', group: 'Look', summary: 1 },
  { key: 'grain', label: 'Grain', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Relief', summary: 2 },
  { key: 'blur', label: 'Blur', kind: 'slider', min: 0, max: 100, step: 1, default: 0, group: 'Focus' },
]

describe('resolveReadout — controls rule', () => {
  const base = {
    rule: { from: 'controls' as const },
    controls: GRADIENT_CONTROLS_SAMPLE,
    config: { preset: 'aurora', grain: 0.18, blur: 34 },
  }

  it('renders a self-describing value bare and a numeric one labelled', () => {
    // "aurora" says what it is; "0.18" does not, so it needs its label.
    expect(resolveReadout(base)).toBe(`aurora${READOUT_SEPARATOR}grain 0.18`)
  })

  it('orders by summary rank, not declaration order', () => {
    const reversed = [
      { ...GRADIENT_CONTROLS_SAMPLE[0], summary: 2 },
      { ...GRADIENT_CONTROLS_SAMPLE[1], summary: 1 },
      GRADIENT_CONTROLS_SAMPLE[2],
    ] as ControlSpec[]
    expect(resolveReadout({ ...base, controls: reversed }))
      .toBe(`grain 0.18${READOUT_SEPARATOR}aurora`)
  })

  it('ignores controls with no summary rank', () => {
    expect(resolveReadout(base)).not.toContain('34')
  })

  it('caps at two even when three are ranked', () => {
    const three = GRADIENT_CONTROLS_SAMPLE.map((c, i) => ({ ...c, summary: i + 1 })) as ControlSpec[]
    expect(resolveReadout({ ...base, controls: three })!.split(READOUT_SEPARATOR)).toHaveLength(2)
  })

  it('falls back to the control default when config omits the key', () => {
    expect(resolveReadout({ ...base, config: { grain: 0.18 } }))
      .toBe(`aurora${READOUT_SEPARATOR}grain 0.18`)
  })

  it('returns null when nothing is ranked', () => {
    const none = GRADIENT_CONTROLS_SAMPLE.map(c => ({ ...c, summary: undefined })) as ControlSpec[]
    expect(resolveReadout({ ...base, controls: none })).toBeNull()
  })

  it('returns null with no controls supplied', () => {
    expect(resolveReadout({ rule: { from: 'controls' } })).toBeNull()
  })
})

describe('GRADIENT_CONTROLS summary declaration', () => {
  it('ranks exactly two controls, at 1 and 2', async () => {
    const { GRADIENT_CONTROLS } = await import('~/lib/gradientfx/controls')
    const ranked = GRADIENT_CONTROLS
      .filter((c: any) => typeof c.summary === 'number')
      .sort((a: any, b: any) => a.summary - b.summary)
    expect(ranked.map((c: any) => c.summary)).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/capsule-readout.unit.spec.ts`
Expected: FAIL — the controls-rule tests return `null`, and the GRADIENT_CONTROLS test finds zero ranked controls.

- [ ] **Step 3: Add the schema field**

In `frontend/app/lib/spacetype/effect.ts`, inside the `ControlMeta` type, after the `animatable` field:

```ts
  /**
   * Rank in the collapsed node capsule's read-out line. The two lowest ranks
   * render, in ascending order; absent means never shown. Opt-in like `agent`
   * and `animatable`, so declaring a control can never silently widen what a
   * capsule advertises.
   */
  summary?: number
```

- [ ] **Step 4: Declare it on Gradient**

In `frontend/app/lib/gradientfx/controls.ts`, add `summary: 1` to the control whose `key` is `preset` and `summary: 2` to the control whose `key` is `grain`.

If either key does not exist under that exact name, pick the closest equivalents — the most identifying `select`/`text` control gets rank 1, the most characteristic numeric slider gets rank 2 — and note the substitution in the commit message. **Do not rename any key**: `controls.ts:5-24` declares them frozen because persisted Collection bindings are `params.<key>`.

- [ ] **Step 5: Implement the controls branch**

In `frontend/app/lib/canvas/capsuleReadout.ts`, add the import:

```ts
import type { ControlSpec } from '~/lib/spacetype/effect'
```

Extend `ReadoutInput` with two fields:

```ts
  /** Studio nodes: the surface's declared control list. */
  controls?: ControlSpec[]
  /** Studio nodes: the current config blob (properties.sailor_<studio>). */
  config?: Record<string, unknown>
```

Add this function above `resolveReadout`:

```ts
function fromControls(controls: ControlSpec[], config: Record<string, unknown>): string[] {
  const ranked = controls
    .filter(c => typeof (c as { summary?: number }).summary === 'number')
    .sort((a, b) => (a as { summary: number }).summary - (b as { summary: number }).summary)

  const out: string[] = []
  for (const c of ranked) {
    if (out.length >= MAX_SUMMARY_PARTS) break
    const raw = c.key in config ? config[c.key] : c.default
    const shown = formatReadoutValue(raw)
    if (shown === null) continue
    // A select or text value names itself ("aurora"); a bare number does not,
    // so it carries its label ("grain 0.18").
    const selfDescribing = c.kind === 'select' || c.kind === 'text' || c.kind === 'font'
    out.push(selfDescribing ? shown : `${c.label.toLowerCase()} ${shown}`)
  }
  return out
}
```

And in `resolveReadout`, before the final `return null`:

```ts
  if (rule.from === 'controls') {
    const parts = fromControls(input.controls ?? [], input.config ?? {})
    return parts.length ? parts.join(READOUT_SEPARATOR) : null
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/capsule-readout.unit.spec.ts`
Expected: PASS — 30 tests

- [ ] **Step 7: Verify the schema change broke nothing**

Run: `cd frontend && npx vitest run`
Expected: PASS. `ControlSpec` is consumed by `StudioControlPanel.vue`, `controlDescriptor.ts`, `collection/studioControls.ts`, `useStudioAgent.ts` and `useVibeControl.ts`; an optional field is additive, so any failure here is a real signal, not noise.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/spacetype/effect.ts \
        frontend/app/lib/gradientfx/controls.ts \
        frontend/app/lib/canvas/capsuleReadout.ts \
        frontend/tests/unit/capsule-readout.unit.spec.ts
git commit -m "feat(capsule): derive studio read-outs from ControlSpec.summary

One opt-in field beside the existing agent/animatable flags, so a studio
gets its capsule read-out from the same declaration that already drives
its inspector, agent vocabulary and motion tracks. Gradient declares it
as the first proof.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Capsule metadata — read-out rules and collapse tiers

Where each node type's read-out rule lives, and whether it collapses by default. There is no unified node registry today — `ToolboxItem`, `AgentCapability` and `GENERATOR_NODE_ICONS` are three disjoint ones, none covering all 28 vue-flow types.

**Files:**
- Create: `frontend/app/lib/canvas/capsuleMeta.ts`
- Create: `frontend/tests/unit/capsule-meta.unit.spec.ts`

**Interfaces:**
- Consumes: `ReadoutRule` from `~/lib/canvas/capsuleReadout`
- Produces: `type CollapseTier = 'always' | 'after-run' | 'never' | 'manual'`, `collapseTier(vueFlowType: string): CollapseTier`, `readoutRuleFor(comfyNodeType: string): ReadoutRule | undefined`, `defaultCollapsed(vueFlowType: string, hasRun: boolean): boolean`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/capsule-meta.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { collapseTier, readoutRuleFor, defaultCollapsed, COLLAPSE_TIERS, READOUT_RULES } from '~/lib/canvas/capsuleMeta'

// The 28 keys registered in VueNodeCanvas.vue:244-263. If this list drifts,
// the tier table has drifted with it and the guard below will say so.
const REGISTERED_TYPES = [
  'comfy', 'note', 'gate', 'artifact-image', 'artifact-text', 'artifact-audio',
  'artifact-video', 'artifact-frame', 'artifact-timeline', 'pose-mannequin',
  'shader-effect', 'artifact-3d', 'space-type', 'gradient-studio',
  'shader-studio', 'texture-studio', 'shape-studio', 'vector-type',
  'scene3d-studio', 'shot-director', 'subgraph-io', 'character',
  'character-sheet', 'lip-sync', 'collection', 'reference', 'batch-grid',
  'sketch-pile',
]

describe('collapseTier', () => {
  it('assigns every registered node type a tier', () => {
    const missing = REGISTERED_TYPES.filter(t => !(t in COLLAPSE_TIERS))
    expect(missing).toEqual([])
  })

  it('does not carry tiers for types that no longer exist', () => {
    const stale = Object.keys(COLLAPSE_TIERS).filter(t => !REGISTERED_TYPES.includes(t))
    expect(stale).toEqual([])
  })

  it('collapses machinery with no output of its own', () => {
    expect(collapseTier('comfy')).toBe('after-run')
    expect(collapseTier('gate')).toBe('always')
    expect(collapseTier('reference')).toBe('always')
  })

  it('never collapses the content itself', () => {
    for (const t of ['artifact-image', 'artifact-frame', 'artifact-video', 'note', 'sketch-pile']) {
      expect(collapseTier(t)).toBe('never')
    }
  })

  it('leaves studios to the user — their live preview is the point', () => {
    for (const t of ['gradient-studio', 'shader-studio', 'space-type', 'scene3d-studio']) {
      expect(collapseTier(t)).toBe('manual')
    }
  })

  it('treats an unknown type as never, so a new node is never hidden by accident', () => {
    expect(collapseTier('some-future-node')).toBe('never')
  })
})

describe('defaultCollapsed', () => {
  it('collapses always-tier types immediately', () => {
    expect(defaultCollapsed('gate', false)).toBe(true)
  })

  it('holds after-run types open until they have run', () => {
    expect(defaultCollapsed('comfy', false)).toBe(false)
    expect(defaultCollapsed('comfy', true)).toBe(true)
  })

  it('never collapses content or studios by default', () => {
    expect(defaultCollapsed('artifact-image', true)).toBe(false)
    expect(defaultCollapsed('gradient-studio', true)).toBe(false)
  })
})

describe('readoutRuleFor', () => {
  it('declares a widgets rule for KSampler', () => {
    expect(readoutRuleFor('KSampler')).toEqual({
      from: 'widgets',
      parts: [{ name: 'steps', suffix: ' steps' }, { name: 'cfg', prefix: 'guidance ' }],
    })
  })

  it('declares a text rule for the prompt encoder', () => {
    expect(readoutRuleFor('CLIPTextEncode')).toEqual({ from: 'text', property: 'text', max: 28 })
  })

  it('returns undefined for an undeclared type — silence, not a guess', () => {
    expect(readoutRuleFor('SomeNodeNobodyMapped')).toBeUndefined()
  })

  it('caps every declared widgets rule at two parts', () => {
    // The resolver caps at render time too, but a three-part declaration is a
    // mistake in the data and should be caught here where it is authored.
    for (const [type, rule] of Object.entries(READOUT_RULES)) {
      if (rule.from === 'widgets') {
        expect(rule.parts.length, `${type} declares too many parts`).toBeLessThanOrEqual(2)
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/capsule-meta.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "~/lib/canvas/capsuleMeta"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/canvas/capsuleMeta.ts`:

```ts
import type { ReadoutRule } from '~/lib/canvas/capsuleReadout'

// Which node types collapse, and what their read-out says.
//
// There is no unified node registry in this codebase — ToolboxItem
// (data/toolbox-items.ts), AgentCapability (lib/agent/capabilities.ts) and
// GENERATOR_NODE_ICONS (data/generator-icons.ts) are three disjoint ones and
// none covers all 28 vue-flow types. Rather than widen one of them and drag
// its consumers along, capsule concerns live here.

export type CollapseTier =
  /** No visual output of its own — a capsule from the moment it exists. */
  | 'always'
  /** Produces something visible downstream; the capsule becomes the record of
   *  how it got there. Opens when freshly added, settles after a clean run. */
  | 'after-run'
  /** This IS the content. Never collapses. */
  | 'never'
  /** Renders a live preview that is most of its value, so the user decides. */
  | 'manual'

/** Keyed by vue-flow node type — the keys of nodeTypes in VueNodeCanvas.vue. */
export const COLLAPSE_TIERS: Record<string, CollapseTier> = {
  comfy: 'after-run',
  gate: 'always',
  'subgraph-io': 'always',
  reference: 'always',
  character: 'always',

  'pose-mannequin': 'after-run',
  'shader-effect': 'after-run',
  'lip-sync': 'after-run',

  note: 'never',
  'artifact-image': 'never',
  'artifact-text': 'never',
  'artifact-audio': 'never',
  'artifact-video': 'never',
  'artifact-frame': 'never',
  'artifact-timeline': 'never',
  'artifact-3d': 'never',
  'character-sheet': 'never',
  collection: 'never',
  'batch-grid': 'never',
  'sketch-pile': 'never',

  'space-type': 'manual',
  'gradient-studio': 'manual',
  'shader-studio': 'manual',
  'texture-studio': 'manual',
  'shape-studio': 'manual',
  'vector-type': 'manual',
  'scene3d-studio': 'manual',
  'shot-director': 'manual',
}

/** Unknown types default to 'never' — a node type nobody has classified should
 *  never be silently hidden behind a capsule. */
export function collapseTier(vueFlowType: string): CollapseTier {
  return COLLAPSE_TIERS[vueFlowType] ?? 'never'
}

export function defaultCollapsed(vueFlowType: string, hasRun: boolean): boolean {
  const tier = collapseTier(vueFlowType)
  if (tier === 'always') return true
  if (tier === 'after-run') return hasRun
  return false
}

/** Keyed by Comfy class_type (node.data.nodeType), not vue-flow type. */
export const READOUT_RULES: Record<string, ReadoutRule> = {
  KSampler: { from: 'widgets', parts: [{ name: 'steps', suffix: ' steps' }, { name: 'cfg', prefix: 'guidance ' }] },
  CLIPTextEncode: { from: 'text', property: 'text', max: 28 },
  EmptyLatentImage: { from: 'widgets', parts: [{ name: 'width', suffix: '' }, { name: 'height', prefix: '× ' }] },
  CheckpointLoaderSimple: { from: 'widgets', parts: [{ name: 'ckpt_name' }] },
  LoraLoader: { from: 'widgets', parts: [{ name: 'lora_name' }, { name: 'strength_model', prefix: 'strength ' }] },
}

export function readoutRuleFor(comfyNodeType: string): ReadoutRule | undefined {
  return READOUT_RULES[comfyNodeType]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/capsule-meta.unit.spec.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/canvas/capsuleMeta.ts \
        frontend/tests/unit/capsule-meta.unit.spec.ts
git commit -m "feat(capsule): collapse tiers and read-out rule table

Four tiers: always / after-run / never / manual. Studios are 'manual'
because their live preview is most of their value; artifacts are 'never'
because they ARE the content. Unknown types default to 'never' so a new
node type is never silently hidden.

Guard test asserts the tier table and the registered nodeTypes list stay
in sync in both directions.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Icon resolution

The capsule needs the same icon `ComfyNode` shows. That logic is a four-branch `v-if` backed by three computeds, and one of the three returns a URL string while the others return Vue components — so it cannot be used as-is.

**Files:**
- Create: `frontend/app/lib/canvas/nodeIcon.ts`
- Create: `frontend/tests/unit/capsule-node-icon.unit.spec.ts`

**Interfaces:**
- Consumes: `getPartnerIcon` from `~/lib/partnerIcons`, `TOOLBOX_NODE_ICONS` from `~/data/toolbox-items`, `getGeneratorIcon` from `~/data/generator-icons`
- Produces: `type NodeIcon = { kind: 'component'; value: unknown } | { kind: 'url'; value: string } | null`, `resolveNodeIcon(opts: { nodeType?: string; category?: string }): NodeIcon`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/capsule-node-icon.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveNodeIcon } from '~/lib/canvas/nodeIcon'
import { getGeneratorIcon, GENERATOR_NODE_ICONS } from '~/data/generator-icons'

describe('resolveNodeIcon', () => {
  it('returns null for a node type nothing knows about', () => {
    expect(resolveNodeIcon({ nodeType: 'TotallyUnknownNode', category: '' })).toBeNull()
  })

  it('prefers the generator icon over the partner logo', () => {
    // Pick a type that genuinely has a generator icon, so precedence is
    // exercised rather than asserted against a single-source type. If this
    // throws, GENERATOR_NODE_ICONS is empty and the test is meaningless —
    // which is itself worth failing on.
    const [generatorType] = Object.keys(GENERATOR_NODE_ICONS)
    expect(generatorType, 'GENERATOR_NODE_ICONS is empty').toBeTruthy()
    expect(getGeneratorIcon(generatorType)).toBeTruthy()

    // Same node, also claiming a partner category: the generator icon wins.
    const icon = resolveNodeIcon({ nodeType: generatorType, category: 'replicate' })
    expect(icon?.kind).toBe('component')
  })

  it('tags a partner logo as a url, not a component', () => {
    const icon = resolveNodeIcon({ nodeType: 'NodeWithNoIconOfItsOwn', category: 'replicate' })
    expect(icon).not.toBeNull()
    expect(icon!.kind).toBe('url')
    expect(typeof icon!.value).toBe('string')
  })

  it('never throws on empty input', () => {
    expect(() => resolveNodeIcon({})).not.toThrow()
    expect(resolveNodeIcon({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/capsule-node-icon.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "~/lib/canvas/nodeIcon"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/canvas/nodeIcon.ts`:

```ts
import { getPartnerIcon } from '~/lib/partnerIcons'
import { TOOLBOX_NODE_ICONS } from '~/data/toolbox-items'
import { getGeneratorIcon } from '~/data/generator-icons'

// Node icon resolution, extracted from the computeds at ComfyNode.vue:85-96 so
// the capsule and the card cannot drift apart.
//
// The awkward part is that the three sources do not agree on a return type:
// getGeneratorIcon and TOOLBOX_NODE_ICONS give Vue components, while
// getPartnerIcon gives a URL string that has to be rendered as an <img>. This
// returns a tagged union so the caller renders the right element rather than
// guessing from typeof.

export type NodeIcon =
  | { kind: 'component'; value: unknown }
  | { kind: 'url'; value: string }
  | null

/** Precedence matches ComfyNode.vue:1329-1335: what the node DOES beats who
 *  runs it, and the toolbox catalog is the last resort. */
export function resolveNodeIcon(opts: { nodeType?: string; category?: string }): NodeIcon {
  const nodeType = opts.nodeType ?? ''

  const generator = nodeType ? getGeneratorIcon(nodeType) : null
  if (generator) return { kind: 'component', value: generator }

  const partner = getPartnerIcon(opts.category ?? '')
  if (partner) return { kind: 'url', value: partner }

  const toolbox = nodeType ? TOOLBOX_NODE_ICONS[nodeType] : null
  if (toolbox) return { kind: 'component', value: toolbox }

  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/capsule-node-icon.unit.spec.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/canvas/nodeIcon.ts \
        frontend/tests/unit/capsule-node-icon.unit.spec.ts
git commit -m "feat(capsule): extract node icon resolution

Returns a tagged union because the three sources disagree on type —
getPartnerIcon yields a URL string, the other two yield Vue components.
The card's template branched on that inline; the capsule needs it as a
value.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: The capsule component

**Files:**
- Create: `frontend/app/components/vue-canvas/NodeCapsule.vue`
- Create: `frontend/app/pages/dev/capsule-lab.vue`

**Interfaces:**
- Consumes: `resolveReadout` (Task 2/3), `resolveNodeIcon` (Task 5)
- Produces: a component with props `{ title: string; readout: string | null; icon: NodeIcon; state: 'ready'|'running'|'done'|'failed'; borderLeft: string; borderRight: string }` and emits `{ action: []; expand: [] }`

The dev page is how this gets verified — there is no `@vue/test-utils` in this repo, so a component cannot be unit-tested. `frontend/app/pages/dev/` already holds a dozen harness pages; this follows that pattern.

- [ ] **Step 1: Write the component**

Create `frontend/app/components/vue-canvas/NodeCapsule.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { Play, Square, RotateCw, AlertCircle } from 'lucide-vue-next'
import type { NodeIcon } from '~/lib/canvas/nodeIcon'

const props = defineProps<{
  title: string
  readout: string | null
  icon: NodeIcon
  state: 'ready' | 'running' | 'done' | 'failed'
  /** Input type colour — left end of the running sweep gradient. */
  borderLeft: string
  /** Output type colour — right end of the running sweep gradient. */
  borderRight: string
}>()

const emit = defineEmits<{ action: []; expand: [] }>()

const actionIcon = computed(() => {
  if (props.state === 'running') return Square
  if (props.state === 'failed') return AlertCircle
  if (props.state === 'done') return RotateCw
  return Play
})

const actionLabel = computed(() => {
  if (props.state === 'running') return 'Stop'
  if (props.state === 'failed') return 'Show the error'
  if (props.state === 'done') return 'Run again'
  return 'Run'
})
</script>

<template>
  <div
    class="node-capsule relative flex w-[228px] items-center gap-[9px] rounded-[11px] border p-[6px_7px] text-left"
    :class="{
      'node-capsule--running': state === 'running',
      'node-capsule--failed': state === 'failed',
    }"
    :style="{ '--border-left': borderLeft, '--border-right': borderRight }"
    @click="emit('expand')"
  >
    <span class="flex size-[26px] flex-none items-center justify-center rounded-[7px] bg-white/[0.07] text-white/70">
      <img v-if="icon?.kind === 'url'" :src="icon.value" class="size-[15px]" alt="">
      <component :is="icon.value" v-else-if="icon?.kind === 'component'" class="size-[15px]" :stroke-width="1.75" />
    </span>

    <span class="flex min-w-0 flex-1 flex-col gap-px">
      <span class="truncate text-[12.5px] leading-[1.25] text-white/[0.88]">{{ title }}</span>
      <span v-if="readout" class="truncate text-[10.5px] leading-[1.25] tabular-nums text-white/40">{{ readout }}</span>
    </span>

    <button
      type="button"
      class="node-capsule__action flex size-[26px] flex-none items-center justify-center rounded-[7px] transition-all"
      :title="actionLabel"
      :aria-label="actionLabel"
      @click.stop="emit('action')"
    >
      <component :is="actionIcon" class="size-[13px]" :stroke-width="1.9" />
    </button>
  </div>
</template>

<style scoped>
.node-capsule {
  background: #1f1f1f;
  border-color: rgba(255, 255, 255, 0.13);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

/* Action blue at three intensities: dim at rest, solid on hover, solid while
   running. One accent, used where the work happens. */
.node-capsule__action {
  background: color-mix(in oklab, var(--action) 20%, transparent);
  color: color-mix(in oklab, var(--action) 58%, white);
  opacity: 0.62;
}
.node-capsule:hover .node-capsule__action {
  background: var(--action);
  color: #fff;
  opacity: 1;
}

/* Running: the border sweep carries it. The button reverts to a plain control
   — a coral stop square on a neutral chip, matching the canvas toolbar at
   layouts/default.vue:4226. No spinner, no solid fill: the sweep already says
   "this is working" and a second moving thing just competes with it. */
.node-capsule--running {
  border-color: transparent;
  /* REQUIRED. The sweep pseudo-element is z-index:-1, which only stays inside
     its parent when the parent forms a stacking context. On a card that came
     free from vue-flow's transformed wrapper; standing alone the sweep paints
     behind the canvas and vanishes with no error. */
  isolation: isolate;
}
.node-capsule--running .node-capsule__action,
.node-capsule--running:hover .node-capsule__action {
  background: rgba(255, 255, 255, 0.07);
  color: var(--palette-coral);
  opacity: 1;
}

/* Lifted verbatim from ComfyNode.vue:1927-1950. Only the duration differs: a
   capsule's perimeter is about a third of a card's, so at the card's 2s the
   beam laps three times as fast and reads as a strobe. */
.node-capsule--running::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  padding: 2px;
  background: linear-gradient(to right, var(--border-left), var(--border-right));
  -webkit-mask:
    conic-gradient(from var(--sweep-angle), transparent 0%, white 6%, white 18%, transparent 26%),
    linear-gradient(white 0 0) content-box,
    linear-gradient(white 0 0);
  -webkit-mask-composite: source-in, xor;
  mask:
    conic-gradient(from var(--sweep-angle), transparent 0%, white 6%, white 18%, transparent 26%),
    linear-gradient(white 0 0) content-box,
    linear-gradient(white 0 0);
  mask-composite: intersect, exclude;
  animation: border-sweep 2.4s linear infinite;
  pointer-events: none;
  z-index: -1;
}

.node-capsule--failed {
  border-color: color-mix(in oklab, var(--palette-coral) 45%, transparent);
}
.node-capsule--failed .node-capsule__action {
  background: color-mix(in oklab, var(--palette-coral) 20%, transparent);
  color: var(--palette-coral);
  opacity: 1;
}
.node-capsule--failed:hover .node-capsule__action {
  background: var(--palette-coral);
  color: #fff;
}

@media (prefers-reduced-motion: reduce) {
  .node-capsule--running::before { animation: none; --sweep-angle: 140deg; }
}
</style>
```

- [ ] **Step 2: Build the harness page**

Create `frontend/app/pages/dev/capsule-lab.vue`:

```vue
<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'
import NodeCapsule from '~/components/vue-canvas/NodeCapsule.vue'

const icon = { kind: 'component' as const, value: Sparkles }
const states = [
  { state: 'ready' as const, title: 'Flux Dev', readout: '28 steps · guidance 3.5' },
  { state: 'running' as const, title: 'Flux Dev', readout: 'rendering · 12.5s' },
  { state: 'done' as const, title: 'Flux Dev', readout: '28 steps · seed 84021' },
  { state: 'failed' as const, title: 'Export', readout: 'No credits remaining' },
]
</script>

<template>
  <div class="min-h-screen bg-[#0b0a09] p-16">
    <h1 class="mb-10 text-sm uppercase tracking-[0.14em] text-white/30">Capsule lab</h1>
    <div class="flex flex-col gap-10">
      <div v-for="s in states" :key="s.state" class="flex items-center gap-8">
        <NodeCapsule
          :title="s.title"
          :readout="s.readout"
          :icon="icon"
          :state="s.state"
          border-left="#facc15"
          border-right="#60a5fa"
        />
        <span class="text-xs uppercase tracking-[0.12em] text-white/30">{{ s.state }}</span>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Verify it renders — including the sweep**

Start the dev server via `preview_start` (never `npm run dev` in a shell — see CLAUDE.md and the launch config), then open `http://127.0.0.1:3000/dev/capsule-lab`.

Use `127.0.0.1`, not `localhost` — `localhost` resolves to the IPv6 listener and returns HTTP 426.

Check with `read_console_messages` for errors, then screenshot.

**The sweep is the thing to actually verify.** It fails silently — a blank border, no console error — if `isolation: isolate` is missing or the `@property --sweep-angle` registration at `main.css:127` is not in scope. Confirm a bright arc is visible travelling the running capsule's border. If it is not, that is the stacking-context bug, not a timing artefact.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/NodeCapsule.vue \
        frontend/app/pages/dev/capsule-lab.vue
git commit -m "feat(capsule): NodeCapsule component + dev harness

Four states, the border sweep reused verbatim at 2.4s, and the action
button as blue-to-run / coral-square-to-stop. isolation:isolate is load
bearing — without it the sweep's negative-z pseudo paints behind the
canvas and disappears silently.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Wire the capsule into the canvas

**Files:**
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (selection CSS around `:7706`)
- Create: `frontend/tests/node-capsule.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-6
- Produces: `node.data.collapsed?: boolean` persisted with the project

- [ ] **Step 1: Render the capsule from ComfyNode**

In `frontend/app/components/vue-canvas/ComfyNode.vue`:

Add to the props `data` type, beside `runningSince`:

```ts
  collapsed?: boolean
```

Add imports in `<script setup>`:

```ts
import NodeCapsule from '~/components/vue-canvas/NodeCapsule.vue'
import { resolveReadout } from '~/lib/canvas/capsuleReadout'
import { resolveNodeIcon } from '~/lib/canvas/nodeIcon'
import { readoutRuleFor, defaultCollapsed } from '~/lib/canvas/capsuleMeta'
```

Add computeds:

```ts
// A node is a capsule when it has been explicitly collapsed, or when its type
// says so by default and nobody has said otherwise. `collapsed` is tri-state
// on purpose: undefined means "use the tier default", so changing a default
// later still reaches nodes saved before the change.
const isCapsule = computed(() => {
  if (typeof props.data.collapsed === 'boolean') return props.data.collapsed
  return defaultCollapsed('comfy', Boolean(props.data.hasRun))
})

// Ticks only while this node is running, so an idle canvas does no work.
const nowTick = ref(Date.now())
let tickId: ReturnType<typeof setInterval> | null = null
watch(() => props.data.running, (running) => {
  if (tickId) { clearInterval(tickId); tickId = null }
  if (running) tickId = setInterval(() => { nowTick.value = Date.now() }, 1000)
}, { immediate: true })
onBeforeUnmount(() => { if (tickId) clearInterval(tickId) })

const capsuleReadout = computed(() => resolveReadout({
  rule: readoutRuleFor(props.data.nodeType as string),
  widgetDefs: props.data.widgetDefs,
  widgetsValues: props.data.widgetsValues,
  properties: props.data.properties,
  running: props.data.running,
  runningSince: props.data.runningSince,
  errorMessage: props.data.errorMessage,
  now: nowTick.value,
}))

const capsuleIcon = computed(() => resolveNodeIcon({
  nodeType: props.data.nodeType as string,
  category: props.data.category,
}))

const capsuleState = computed<'ready' | 'running' | 'done' | 'failed'>(() => {
  if (props.data.error) return 'failed'
  if (props.data.running) return 'running'
  return props.data.hasRun ? 'done' : 'ready'
})
```

Ensure `ref`, `watch`, `onBeforeUnmount` are imported from `vue` if they are not already.

At the top of the template, wrap the existing card in a `v-else` and render the capsule first:

```vue
  <NodeCapsule
    v-if="isCapsule"
    class="comfy-node"
    :title="displayTitle"
    :readout="capsuleReadout"
    :icon="capsuleIcon"
    :state="capsuleState"
    :border-left="borderColorLeft"
    :border-right="borderColorRight"
    @action="onRunNode"
    @expand="onExpandCapsule"
  />
```

Keeping `class="comfy-node"` on the root is what makes the selection outline at `VueNodeCanvas.vue:7706-7709` apply for free.

`onRunNode` should call the same handler the existing footer run button already uses — find it, don't write a second one.

`onExpandCapsule` mutates `props.data` directly. That is this component's established pattern, not a shortcut: every widget edit in the file does it (`ComfyNode.vue:725`, `:890`, `:940` all assign straight into `props.data.widgetsValues[idx]`). `props.data` is the same reactive object held in the canvas `nodes` array, so the write propagates and persists.

```ts
function onExpandCapsule() {
  props.data.collapsed = false
}
```

- [ ] **Step 2: Collapse the ports without detaching the edges**

This is the step that breaks everything if it is skipped.

Ports are **siblings of the card**, not children — `ComfyNode.vue:1249-1275` wraps both in `<div ref="portSyncRoot" class="relative w-fit">` so the card's opaque background occludes each dot's inner half. That layout is a gift here: swapping the card for a capsule leaves the `VueCanvasNodePort` elements untouched, so **vue-flow handles keep their ids and every existing edge stays attached**. Do not move the ports inside the capsule.

What does break is spacing. `PORT_PITCH = 20` in `app/lib/canvas/portLayout.ts` stacks ports downward from the vertical centre, so a node with four inputs needs 80px of height. A capsule is 40px. Four dots would hang off it.

When collapsed, ports converge on the edge midpoint and go non-interactive:

```css
/* Collapsed: every port sits at the capsule's vertical centre, so edges
   converge on one point per side instead of trailing off a 40px chip. They
   stay in the DOM with their handle ids intact — that is what keeps the
   edges attached. Non-interactive because you cannot meaningfully aim at
   four overlapping dots; expand the node to rewire it. */
.comfy-node-collapsed .node-port {
  top: 50% !important;
  margin-top: -6px !important;
  opacity: 0;
  pointer-events: none;
}
```

Apply `comfy-node-collapsed` to the `portSyncRoot` wrapper when `isCapsule` is true:

```vue
  <div ref="portSyncRoot" class="relative w-fit" :class="{ 'comfy-node-collapsed': isCapsule }">
```

Confirm the selector matches the real port class — `NodePort.vue:76` uses `node-port__dot` on the visible disc and the root carries the handle. Target whichever element `portLayout` positions.

- [ ] **Step 3: Raise the expanded node above its neighbours**

In `frontend/app/components/vue-canvas/VueNodeCanvas.vue`, beside the selection rules around `:7706`:

```css
/* A capsule that has just expanded must sit above its neighbours, or the card
   it grew into is clipped by whatever is drawn after it. There is no tracked
   hover state on the canvas (hoverNodeIds is the agent proposal highlight, not
   the mouse), so this is done in CSS. */
.vue-flow__node:has(.node-capsule:hover) {
  z-index: 20 !important;
}
```

- [ ] **Step 4: Write the E2E test**

Create `frontend/tests/node-capsule.spec.ts`, following the conventions in `frontend/tests/_helpers.ts`:

```ts
import { test, expect } from '@playwright/test'

// Adding a node headlessly: dispatch sailor:addNode on the window. This is the
// same path the toolbox and the nodes sidebar use (useNodeSearch.ts:171), so it
// exercises real node creation rather than a test-only shortcut.
async function addNode(page: import('@playwright/test').Page, nodeType: string) {
  await page.evaluate((t) => {
    window.dispatchEvent(new CustomEvent('sailor:addNode', { detail: { nodeType: t } }))
  }, nodeType)
}

test.describe('node capsule', () => {
  test('a freshly added generator opens as a card, not a capsule', async ({ page }) => {
    await page.goto('/')
    await addNode(page, 'KSampler')
    await expect(page.locator('.comfy-node').first()).toBeVisible()
    await expect(page.locator('.node-capsule')).toHaveCount(0)
  })

  test('a collapsed node shows its read-out and expands on click', async ({ page }) => {
    await page.goto('/')
    await addNode(page, 'KSampler')

    // Force the collapsed state directly rather than running a paid generation.
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('sailor:test:setNodeData', {
        detail: { match: 'KSampler', patch: { collapsed: true } },
      }))
    })

    const capsule = page.locator('.node-capsule')
    await expect(capsule).toBeVisible()
    await expect(capsule).toContainText('steps')

    await capsule.click()
    await expect(page.locator('.node-capsule')).toHaveCount(0)
  })

  test('collapsing keeps existing edges attached', async ({ page }) => {
    await page.goto('/')
    await addNode(page, 'CLIPTextEncode')
    await addNode(page, 'KSampler')
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('sailor:applyEffect', { detail: { connect: 'all' } }))
    })
    const before = await page.locator('.vue-flow__edge').count()
    expect(before).toBeGreaterThan(0)

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('sailor:test:setNodeData', {
        detail: { match: 'KSampler', patch: { collapsed: true } },
      }))
    })
    await expect(page.locator('.node-capsule')).toBeVisible()
    await expect(page.locator('.vue-flow__edge')).toHaveCount(before)
  })

  test('the action button does not expand the capsule', async ({ page }) => {
    await page.goto('/')
    await addNode(page, 'KSampler')
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('sailor:test:setNodeData', {
        detail: { match: 'KSampler', patch: { collapsed: true } },
      }))
    })
    await page.locator('.node-capsule__action').click()
    await expect(page.locator('.node-capsule')).toBeVisible()
  })
})
```

This needs a `sailor:test:setNodeData` listener in `VueNodeCanvas.vue` that patches the first node whose `nodeType` contains `detail.match`. Add it beside the existing `sailor:addNode` listener at `:4506`, guarded so it is a no-op in production:

```ts
if (import.meta.dev) window.addEventListener('sailor:test:setNodeData', handleTestSetNodeData)
```

- [ ] **Step 5: Run the E2E test**

Run: `cd frontend && npx playwright test tests/node-capsule.spec.ts`
Expected: PASS — 4 tests

- [ ] **Step 6: Verify the sweep survives integration**

With the dev server up, add a KSampler, force `{ collapsed: true, running: true, runningSince: Date.now() }` through the same test event, and confirm the sweep arc is visible on the capsule inside the canvas.

This is a separate check from Task 6 Step 3 because `isolation: isolate` and the expanded-card `z-index` both touch stacking, and they can only break each other in combination.

- [ ] **Step 7: Full verification**

```bash
cd frontend && npx vitest run && npx nuxi typecheck 2>&1 | tail -3
```

Expected: unit suite green; typecheck error count at or below the ~328 baseline.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/components/vue-canvas/ComfyNode.vue \
        frontend/app/components/vue-canvas/VueNodeCanvas.vue \
        frontend/tests/node-capsule.spec.ts
git commit -m "feat(capsule): render collapsed nodes as capsules

collapsed is tri-state — undefined means 'use the tier default', so
changing a default later still reaches nodes saved before the change.
The elapsed ticker runs only while a node is running, so an idle canvas
does no work.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Deferred

Out of this plan, from the spec:

- **Read-out rules beyond the five declared types.** Degrade-to-silence makes this safely incremental — add rules to `READOUT_RULES` as they matter.
- **`summary` declarations on the other studio surfaces.** Gradient is the proof; Texture, Shape, VectorType, Shader and Space Type follow the same one-line pattern.
- **The studio manual-collapse toggle.** Tier `'manual'` exists and returns `false` from `defaultCollapsed`, so studios behave correctly today — there is simply no UI to collapse one yet.
- **Cost on the capsule.** Open question 2 in the spec.
- **A real `@node-mouse-enter` handler.** The CSS `:has()` approach in Task 7 Step 2 is the lighter option; revisit if it proves insufficient.
