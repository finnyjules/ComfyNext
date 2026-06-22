# AI Control Copilot (Vibe Control) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live natural-language "vibe control" to Type Studio that proposes parameter changes within the current effect, applied live and ratified by the user.

**Architecture:** A pure descriptor/validation lib normalizes the active effect's `ControlSpec[]` for an LLM and validates the returned patch. A thin Nuxt server route (`/api/vibe`) calls Claude Haiku with structured outputs, mirroring the existing `pipeline-suggest` route. A composable (`useVibeControl`, mirroring `usePortIntent`) glues them. A `VibeControlBar.vue` component (built on existing Studio primitives) renders the prompt + proposal, wired into `SpaceTypeSurface.vue` with live-apply + snapshot/revert.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest (`tests/unit/**/*.unit.spec.ts`), Claude Haiku 4.5 via raw `fetch` (no SDK), existing `Studio*` control primitives.

## Global Constraints

- **Params, not pixels:** the AI only emits parameter changes; never images, never the user's text content.
- **Authority = params within the current effect only.** Never switch effect/mode. AI-editable kinds: `slider`, `select`, `color`, `font`. Excluded: `text`, `textList`, `fillList`, `path`.
- **Model:** `claude-haiku-4-5` exactly (bare string, no date suffix). Structured outputs via `output_config: { format: { type: 'json_schema', schema } }`.
- **Anthropic key:** user-supplied, read on the frontend via `getLocalSetting('ComfyNext.AI.AnthropicApiKey')`, passed in the request body — same as `usePortIntent` / `useExplain`.
- **No purple/violet accents.** AI-touched = amber; commit/Keep = emerald; primary = white. Build only on existing `Studio*` primitives + current dark tokens — no parallel design language.
- **Structured-output schema rule:** every object needs `additionalProperties: false`; dynamic-key maps are NOT allowed, so the patch is returned as a fixed-shape `changes: [{key, value}]` array (mirrors `pipeline-suggest`'s `widgets`).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Work on `main` directly (no feature branches — project convention).

## File Structure

- Create `frontend/app/lib/spacetype/controlDescriptor.ts` — pure: `describeControls()` + `validatePatch()` + `DescribedControl` type. Core logic, fully unit-tested.
- Modify `frontend/app/lib/spacetype/effect.ts` — add optional `hint`/`aiEditable` to `ControlSpec`.
- Create `frontend/app/lib/vibePrompt.ts` — pure: `VIBE_SCHEMA` + `buildVibePrompt()`. Unit-tested.
- Create `frontend/server/api/vibe.post.ts` — thin route, mirrors `pipeline-suggest.post.ts`. Manual/curl verify.
- Create `frontend/app/composables/useVibeControl.ts` — glue, mirrors `usePortIntent.ts`. Manual verify.
- Create `frontend/app/components/vue-canvas/VibeControlBar.vue` — prompt + proposal UI. Screenshot verify.
- Modify `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — mount bar, live-apply, snapshot/revert, moved-key highlight. Screenshot verify.
- Modify `frontend/app/lib/spacetype/effects/boost.ts` — add `hint`s to the Extrude controls (demo of the quality lever).
- Create `frontend/tests/unit/vibe-control.unit.spec.ts` — tests for the two pure libs.

> **Testing note (matches codebase reality):** routes (`server/api/*.post.ts`) and composables (`app/composables/*`) have **no** unit tests in this repo (e.g. `pipeline-suggest.post.ts`, `usePortIntent.ts` are untested). Vue visuals are verified via dev-server screenshots (project convention). So Tasks 1–2 (pure libs) use full TDD; Tasks 3–6 use manual / curl / screenshot verification.

---

### Task 1: Control descriptor + patch validator (pure lib)

**Files:**
- Modify: `frontend/app/lib/spacetype/effect.ts` (the `ControlSpec` union, lines 6–22)
- Create: `frontend/app/lib/spacetype/controlDescriptor.ts`
- Test: `frontend/tests/unit/vibe-control.unit.spec.ts`

**Interfaces:**
- Consumes: `ControlSpec`, `Params`, `ParamValue` from `~/lib/spacetype/effect`.
- Produces:
  - `DescribedControl = { path: string; label: string; kind: 'slider'|'select'|'color'|'font'; min?: number; max?: number; step?: number; options?: string[]; hint?: string; current: ParamValue }`
  - `describeControls(controls: ControlSpec[], params: Params): DescribedControl[]`
  - `validatePatch(patch: Record<string, ParamValue>, described: DescribedControl[]): Record<string, ParamValue>`

- [ ] **Step 1: Add `hint`/`aiEditable` to `ControlSpec`**

In `frontend/app/lib/spacetype/effect.ts`, change the union to intersect a shared meta bag. Replace the opening `export type ControlSpec =` line and the closing of the union (after the `path` variant on line 22) so the whole union is wrapped:

```ts
/** Optional metadata any control kind may carry. `hint` is a short semantic
 *  description used by the AI control copilot (and doubles as tooltip text).
 *  `aiEditable` overrides the kind-based default (slider/select/color/font are
 *  editable; text/textList/fillList/path are not). */
type ControlMeta = { hint?: string; aiEditable?: boolean }

export type ControlSpec = (
  | { key: string; label: string; kind: 'slider'; min: number; max: number; step: number; default: number; group?: string }
  | { key: string; label: string; kind: 'text'; default: string; group?: string }
  | { key: string; label: string; kind: 'textList'; default: string; group?: string }
  | { key: string; label: string; kind: 'fillList'; default: string; group?: string }
  | { key: string; label: string; kind: 'color'; default: string; group?: string }
  | { key: string; label: string; kind: 'select'; options: string[]; default: string; group?: string }
  | { key: string; label: string; kind: 'font'; default: string; group?: string }
  | { key: string; label: string; kind: 'path'; default: string; group?: string }
) & ControlMeta
```

(Keep the existing explanatory comments on the `textList` / `fillList` / `path` variants.)

- [ ] **Step 2: Write the failing tests**

Create `frontend/tests/unit/vibe-control.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'
import type { ControlSpec, Params } from '~/lib/spacetype/effect'

const CONTROLS: ControlSpec[] = [
  { key: 'depth', label: 'Depth', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, hint: 'higher = deeper' },
  { key: 'palette', label: 'Palette', kind: 'select', options: ['cool', 'warm', 'mono'], default: 'cool' },
  { key: 'tint', label: 'Tint', kind: 'color', default: '#101010' },
  { key: 'message', label: 'Text', kind: 'text', default: 'HELLO' },
  { key: 'locked', label: 'Locked', kind: 'slider', min: 0, max: 1, step: 0.1, default: 0.2, aiEditable: false },
]

describe('describeControls', () => {
  it('keeps AI-editable kinds, drops text/locked', () => {
    const out = describeControls(CONTROLS, { depth: 0.7 })
    const paths = out.map(c => c.path)
    expect(paths).toEqual(['depth', 'palette', 'tint'])
  })
  it('reports current value over default', () => {
    const out = describeControls(CONTROLS, { depth: 0.7 } as Params)
    expect(out.find(c => c.path === 'depth')!.current).toBe(0.7)
    expect(out.find(c => c.path === 'palette')!.current).toBe('cool')
  })
})

describe('validatePatch', () => {
  const described = describeControls(CONTROLS, {})
  it('clamps and snaps sliders', () => {
    expect(validatePatch({ depth: 9 }, described)).toEqual({ depth: 1 })
    expect(validatePatch({ depth: -5 }, described)).toEqual({ depth: 0 })
    expect(validatePatch({ depth: 0.333 }, described)).toEqual({ depth: 0.33 })
  })
  it('drops unknown keys, bad enums, bad colors', () => {
    expect(validatePatch({ nope: 1 }, described)).toEqual({})
    expect(validatePatch({ palette: 'purple' }, described)).toEqual({})
    expect(validatePatch({ tint: 'red' }, described)).toEqual({})
  })
  it('keeps valid enum and color', () => {
    expect(validatePatch({ palette: 'warm', tint: '#ABCDEF' }, described))
      .toEqual({ palette: 'warm', tint: '#ABCDEF' })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npm run test:unit -- vibe-control`
Expected: FAIL — `describeControls`/`validatePatch` not exported (module not found).

- [ ] **Step 4: Implement `controlDescriptor.ts`**

Create `frontend/app/lib/spacetype/controlDescriptor.ts`:

```ts
import type { ControlSpec, Params, ParamValue } from '~/lib/spacetype/effect'

/** A control normalized for the AI copilot. `path` equals the control key for
 *  Type/Texture (flat). A future Shader adapter will emit dotted paths here. */
export interface DescribedControl {
  path: string
  label: string
  kind: 'slider' | 'select' | 'color' | 'font'
  min?: number
  max?: number
  step?: number
  options?: string[]
  hint?: string
  current: ParamValue
}

const AI_EDITABLE_KINDS = new Set(['slider', 'select', 'color', 'font'])

function isEditable(c: ControlSpec): boolean {
  if (typeof c.aiEditable === 'boolean') return c.aiEditable
  return AI_EDITABLE_KINDS.has(c.kind)
}

/** Build the normalized, AI-editable-only descriptor for the active effect. */
export function describeControls(controls: ControlSpec[], params: Params): DescribedControl[] {
  const out: DescribedControl[] = []
  for (const c of controls) {
    if (!isEditable(c)) continue
    const current = params[c.key] ?? c.default
    const d: DescribedControl = { path: c.key, label: c.label, kind: c.kind as DescribedControl['kind'], current }
    if (c.hint) d.hint = c.hint
    if (c.kind === 'slider') { d.min = c.min; d.max = c.max; d.step = c.step }
    if (c.kind === 'select') d.options = c.options
    out.push(d)
  }
  return out
}

const HEX6 = /^#[0-9a-fA-F]{6}$/

/** Validate/clamp a raw patch against the descriptor. Unknown keys, out-of-enum
 *  selects, and malformed colors are dropped; sliders are coerced, clamped to
 *  [min,max] and snapped to step. The result is safe to apply to params. */
export function validatePatch(
  patch: Record<string, ParamValue>,
  described: DescribedControl[],
): Record<string, ParamValue> {
  const byPath = new Map(described.map(d => [d.path, d]))
  const out: Record<string, ParamValue> = {}
  for (const [key, raw] of Object.entries(patch ?? {})) {
    const d = byPath.get(key)
    if (!d) continue
    if (d.kind === 'slider') {
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      const snapped = Math.round((n - d.min!) / d.step!) * d.step! + d.min!
      const clamped = Math.min(d.max!, Math.max(d.min!, snapped))
      out[key] = Number(clamped.toFixed(6))
    }
    else if (d.kind === 'select') {
      if (typeof raw === 'string' && d.options!.includes(raw)) out[key] = raw
    }
    else if (d.kind === 'color') {
      if (typeof raw === 'string' && HEX6.test(raw)) out[key] = raw
    }
    else if (d.kind === 'font') {
      if (typeof raw === 'string' && raw.trim()) out[key] = raw
    }
  }
  return out
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm run test:unit -- vibe-control`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/spacetype/effect.ts frontend/app/lib/spacetype/controlDescriptor.ts frontend/tests/unit/vibe-control.unit.spec.ts
git commit -m "feat(vibe-control): control descriptor + patch validator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Vibe prompt + schema (pure lib)

**Files:**
- Create: `frontend/app/lib/vibePrompt.ts`
- Test: `frontend/tests/unit/vibe-control.unit.spec.ts` (append)

**Interfaces:**
- Consumes: `DescribedControl` from `~/lib/spacetype/controlDescriptor`.
- Produces:
  - `VIBE_SCHEMA` (a JSON-schema object with `changes: [{key, value}]` + `rationale`)
  - `buildVibePrompt(described: DescribedControl[], phrase: string, effectLabel: string): string`

- [ ] **Step 1: Write the failing tests (append to the spec file)**

Append to `frontend/tests/unit/vibe-control.unit.spec.ts`:

```ts
import { VIBE_SCHEMA, buildVibePrompt } from '~/lib/vibePrompt'

describe('vibePrompt', () => {
  it('schema is strict (no open objects)', () => {
    expect(VIBE_SCHEMA.additionalProperties).toBe(false)
    expect(VIBE_SCHEMA.properties.changes.items.additionalProperties).toBe(false)
    expect(VIBE_SCHEMA.required).toEqual(['changes', 'rationale'])
  })
  it('prompt embeds the phrase, effect label, control labels and ranges', () => {
    const described = describeControls(CONTROLS, { depth: 0.7 })
    const p = buildVibePrompt(described, 'warmer and deeper', 'Extrude')
    expect(p).toContain('warmer and deeper')
    expect(p).toContain('Extrude')
    expect(p).toContain('depth')
    expect(p).toContain('higher = deeper') // the hint
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:unit -- vibe-control`
Expected: FAIL — `~/lib/vibePrompt` not found.

- [ ] **Step 3: Implement `vibePrompt.ts`**

Create `frontend/app/lib/vibePrompt.ts`:

```ts
import type { DescribedControl } from '~/lib/spacetype/controlDescriptor'

/** Structured-output schema. Patch is a fixed-shape array (not a dynamic-key
 *  object) because strict json_schema forbids open objects. */
export const VIBE_SCHEMA = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      description: 'Only the controls you want to change. Empty if nothing fits.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Exact control key from the list' },
          value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        },
        required: ['key', 'value'],
        additionalProperties: false,
      },
    },
    rationale: { type: 'string', description: 'One short sentence explaining the changes' },
  },
  required: ['changes', 'rationale'],
  additionalProperties: false,
}

/** Build the user prompt: the effect, its AI-editable controls (with ranges,
 *  options, hints, and current values), and the user's phrase. */
export function buildVibePrompt(described: DescribedControl[], phrase: string, effectLabel: string): string {
  const lines = described.map((c) => {
    const range = c.kind === 'slider' ? ` range ${c.min}..${c.max} step ${c.step}` : ''
    const opts = c.kind === 'select' ? ` options [${c.options!.join(', ')}]` : ''
    const hint = c.hint ? ` — ${c.hint}` : ''
    return `- ${c.key} ("${c.label}", ${c.kind})${range}${opts}; current ${JSON.stringify(c.current)}${hint}`
  }).join('\n')

  return `You are a visual-design copilot for a typography effect called "${effectLabel}".
The user describes a vibe and you propose parameter changes that achieve it.

CONTROLS YOU MAY CHANGE (you may ONLY use these keys):
${lines}

USER REQUEST: "${phrase}"

Rules:
- Return only the controls that should change to achieve the request — leave everything else alone.
- Slider values must be numbers within the stated range. Select values must be one of the listed options. Color values must be 6-digit hex like "#RRGGBB".
- Do not invent keys. Do not change the text content.
- "rationale" is one short sentence the user will read.`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm run test:unit -- vibe-control`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/vibePrompt.ts frontend/tests/unit/vibe-control.unit.spec.ts
git commit -m "feat(vibe-control): prompt builder + structured-output schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `/api/vibe` route

**Files:**
- Create: `frontend/server/api/vibe.post.ts`

**Interfaces:**
- Consumes (request body): `{ apiKey: string; controls: DescribedControl[]; phrase: string; effectLabel: string }`.
- Produces (response): `{ changes: { key: string; value: string | number }[]; rationale: string }`.

- [ ] **Step 1: Implement the route (mirror `pipeline-suggest.post.ts`)**

Create `frontend/server/api/vibe.post.ts`:

```ts
// Natural-language → parameter patch for the Type Studio "vibe control".
// Sibling of pipeline-suggest.post.ts: raw fetch, user-supplied Anthropic key,
// no SDK. Haiku + structured outputs keep it fast and ~half a cent per ask.
import { VIBE_SCHEMA, buildVibePrompt } from '~/lib/vibePrompt'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { apiKey, controls, phrase, effectLabel } = body || {}

  if (!apiKey || typeof apiKey !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing Anthropic API key' })
  }
  if (!Array.isArray(controls) || !phrase || typeof phrase !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing controls or phrase' })
  }

  const prompt = buildVibePrompt(controls, phrase, typeof effectLabel === 'string' ? effectLabel : 'effect')

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        output_config: { format: { type: 'json_schema', schema: VIBE_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[vibe] Anthropic error:', res.status, errText)
      const errBody = (() => { try { return JSON.parse(errText) } catch { return {} } })()
      const message = errBody?.error?.message || `Anthropic API error: ${res.status}`
      throw createError({ statusCode: res.status, message })
    }

    const data: any = await res.json()
    const text = data?.content?.find((b: any) => b.type === 'text')?.text
    if (!text) throw createError({ statusCode: 502, message: 'Empty response from Claude' })
    try {
      const parsed = JSON.parse(text)
      return { changes: parsed.changes ?? [], rationale: parsed.rationale ?? '' }
    }
    catch {
      throw createError({ statusCode: 502, message: 'Malformed response from Claude' })
    }
  }
  catch (err: any) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, message: err?.message || 'Failed to call Claude API' })
  }
})
```

- [ ] **Step 2: Verify input validation without a network call**

Run (dev server must be running — `cd frontend && npm run dev` in another terminal):

```bash
curl -s -X POST http://localhost:3000/api/vibe -H 'content-type: application/json' -d '{}'
```

Expected: HTTP 400 body containing `Missing Anthropic API key`.

- [ ] **Step 3: Verify the happy path (real key required)**

```bash
curl -s -X POST http://localhost:3000/api/vibe -H 'content-type: application/json' \
  -d '{"apiKey":"sk-ant-...","effectLabel":"Extrude","phrase":"warmer and deeper",
       "controls":[{"path":"depth","label":"Depth","kind":"slider","min":0,"max":1,"step":0.01,"current":0.5,"hint":"higher = deeper"}]}'
```

Expected: JSON like `{"changes":[{"key":"depth","value":0.8}],"rationale":"..."}`. (If you have no key, skip — Task 6 exercises this end-to-end in the app.)

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/server/api/vibe.post.ts
git commit -m "feat(vibe-control): /api/vibe route (Haiku, structured output)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `useVibeControl` composable

**Files:**
- Create: `frontend/app/composables/useVibeControl.ts`

**Interfaces:**
- Consumes: `describeControls`, `validatePatch` from `~/lib/spacetype/controlDescriptor`; `ControlSpec`, `Params` from `~/lib/spacetype/effect`; `/api/vibe`; `useLocalSettings().getLocalSetting`.
- Produces: `useVibeControl()` returning `requestPatch(controls: ControlSpec[], params: Params, effectLabel: string, phrase: string): Promise<{ patch: Record<string, ParamValue>; rationale: string }>`.

- [ ] **Step 1: Implement the composable (mirror `usePortIntent.ts`)**

Create `frontend/app/composables/useVibeControl.ts`:

```ts
import type { ControlSpec, Params, ParamValue } from '~/lib/spacetype/effect'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'

export function useVibeControl() {
  const { getLocalSetting } = useLocalSettings()

  async function requestPatch(
    controls: ControlSpec[],
    params: Params,
    effectLabel: string,
    phrase: string,
  ): Promise<{ patch: Record<string, ParamValue>; rationale: string }> {
    const apiKey = getLocalSetting('ComfyNext.AI.AnthropicApiKey')
    if (!apiKey) throw new Error('No Anthropic API key set. Add your key in Settings → AI.')

    const described = describeControls(controls, params)
    if (!described.length) throw new Error('This effect has no AI-adjustable controls.')

    const res = await $fetch<{ changes: { key: string; value: ParamValue }[]; rationale: string }>('/api/vibe', {
      method: 'POST',
      body: { apiKey, controls: described, phrase, effectLabel },
    })

    const raw: Record<string, ParamValue> = {}
    for (const c of res.changes ?? []) raw[c.key] = c.value
    const patch = validatePatch(raw, described)
    return { patch, rationale: res.rationale ?? '' }
  }

  return { requestPatch }
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx nuxi typecheck 2>&1 | grep -i vibe || echo "no vibe type errors"`
Expected: `no vibe type errors` (or a clean run). Fix any reported `vibe`-related type errors before continuing.

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/composables/useVibeControl.ts
git commit -m "feat(vibe-control): useVibeControl composable (build descriptor, validate patch)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `VibeControlBar.vue` component

**Files:**
- Create: `frontend/app/components/vue-canvas/VibeControlBar.vue`

**Interfaces:**
- Props: `busy: boolean`; `proposal: { rationale: string; chips: { label: string; before: string; after: string }[] } | null`.
- Emits: `submit (phrase: string)`, `keep ()`, `revert ()`, `focusControl (path: string)`.
- Built only from `StudioButton` + native inputs styled with existing dark tokens. Amber = AI-touched, emerald = Keep.

- [ ] **Step 1: Implement the component**

Create `frontend/app/components/vue-canvas/VibeControlBar.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'

defineProps<{
  busy: boolean
  proposal: { rationale: string; chips: { label: string; before: string; after: string; path: string }[] } | null
}>()
const emit = defineEmits<{
  submit: [phrase: string]
  keep: []
  revert: []
  focusControl: [path: string]
}>()

const phrase = ref('')
function go() {
  const p = phrase.value.trim()
  if (p) emit('submit', p)
}
</script>

<template>
  <div class="mb-3">
    <!-- prompt bar -->
    <div class="flex items-center gap-2 rounded-[10px] border border-white/10 bg-white/[0.04] px-2.5 py-2">
      <span class="text-[13px] text-amber-400/90">✦</span>
      <input
        v-model="phrase"
        :disabled="busy"
        type="text"
        placeholder="Describe a vibe — “warmer, more chaotic”"
        class="flex-1 bg-transparent text-[12.5px] text-white/90 placeholder:text-white/35 outline-none"
        @keydown.enter="go"
      >
      <StudioButton variant="primary" :disabled="busy || !phrase.trim()" @click="go">
        {{ busy ? '…' : 'Apply' }}
      </StudioButton>
    </div>

    <!-- proposal summary header -->
    <div v-if="proposal" class="mt-1.5 rounded-[11px] border border-amber-400/30 bg-white/[0.04] p-3">
      <div class="mb-1 flex items-center gap-2">
        <span class="text-amber-400/90">✦</span>
        <span class="text-[12.5px] font-semibold text-white/90">{{ proposal.chips.length }} change{{ proposal.chips.length === 1 ? '' : 's' }}</span>
        <span class="ml-auto flex gap-1.5">
          <button class="rounded-[7px] border border-white/10 px-3 py-1 text-[11.5px] text-white/60" @click="emit('revert')">Revert</button>
          <button class="rounded-[7px] bg-emerald-400 px-3 py-1 text-[11.5px] font-semibold text-emerald-950" @click="emit('keep')">Keep</button>
        </span>
      </div>
      <p v-if="proposal.rationale" class="mb-2 text-[11px] italic text-white/40">{{ proposal.rationale }}</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="chip in proposal.chips" :key="chip.path"
          class="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-[3px] text-[10.5px] tabular-nums text-amber-300"
          @click="emit('focusControl', chip.path)"
        >{{ chip.label }} {{ chip.before }}→{{ chip.after }}</button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify it renders (screenshot)**

Start the dev server, open Type Studio, and confirm the bar appears at the top of the controls panel. Push a fake proposal via Vue devtools or temporarily hard-code one. Use the preview screenshot workflow to confirm: amber prompt bar, emerald Keep button, amber chips, no purple. (Full wiring is Task 6 — this step only confirms the component renders on its own.)

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/components/vue-canvas/VibeControlBar.vue
git commit -m "feat(vibe-control): VibeControlBar component (prompt + proposal header)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire into `SpaceTypeSurface.vue` (live-apply + snapshot/revert + moved highlight)

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (script `<script setup>` block and the `#controls` template; the control loop is around lines 601–633, `params` is the reactive object from ~line 59)

**Interfaces:**
- Consumes: `useVibeControl().requestPatch`; `VibeControlBar`; existing reactive `params`, `effect`.
- Produces: live param mutation (drives the existing preview reactivity), a `vibeMoved` set used to amber-highlight moved controls.

- [ ] **Step 1: Add imports + state to the script block**

Near the other imports in `SpaceTypeSurface.vue` add:

```ts
import VibeControlBar from '~/components/vue-canvas/VibeControlBar.vue'
import { useVibeControl } from '~/composables/useVibeControl'
```

After the `params` reactive declaration (around line 59) add:

```ts
const { requestPatch } = useVibeControl()
const vibeBusy = ref(false)
const vibeProposal = ref<{ rationale: string; chips: { label: string; before: string; after: string; path: string }[] } | null>(null)
const vibeSnapshot = ref<Params | null>(null)
const vibeMoved = computed(() => new Set((vibeProposal.value?.chips ?? []).map(c => c.path)))

function fmt(v: unknown): string {
  return typeof v === 'number' ? Number(v).toFixed(2) : String(v)
}

async function onVibe(phrase: string) {
  vibeBusy.value = true
  try {
    const before: Params = { ...params }
    const { patch, rationale } = await requestPatch(effect.value.controls, params, effect.value.label, phrase)
    const keys = Object.keys(patch)
    if (!keys.length) { vibeProposal.value = null; return }
    vibeSnapshot.value = before
    const labelFor = (k: string) => effect.value.controls.find(c => c.key === k)?.label ?? k
    vibeProposal.value = {
      rationale,
      chips: keys.map(k => ({ path: k, label: labelFor(k), before: fmt(before[k]), after: fmt(patch[k]) })),
    }
    Object.assign(params, patch) // live preview updates via existing reactivity
  }
  catch (e: any) {
    vibeProposal.value = null
    // surface the error via whatever toast/notice this surface already uses
    console.error('[vibe]', e?.message || e)
  }
  finally {
    vibeBusy.value = false
  }
}

function onVibeKeep() { vibeProposal.value = null; vibeSnapshot.value = null }

function onVibeRevert() {
  if (vibeSnapshot.value && vibeProposal.value) {
    for (const chip of vibeProposal.value.chips) params[chip.path] = vibeSnapshot.value[chip.path]
  }
  vibeProposal.value = null
  vibeSnapshot.value = null
}

function onVibeFocus(path: string) {
  const el = document.querySelector(`[data-control-key="${path}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
```

(Confirm `computed` and `ref` are already imported in this file; they are used elsewhere in it. Add to the `vue` import if missing.)

- [ ] **Step 2: Mount the bar in the `#controls` slot**

In the `#controls` template, immediately inside the slot (before the effect `<select>` around line 578–582), add:

```vue
<VibeControlBar
  :busy="vibeBusy"
  :proposal="vibeProposal"
  @submit="onVibe"
  @keep="onVibeKeep"
  @revert="onVibeRevert"
  @focus-control="onVibeFocus"
/>
```

- [ ] **Step 3: Add the moved-highlight hook to the control loop**

On the per-control wrapper `<div v-for="c in section.controls" ...>` (around line 607), add a data attribute (for chip scroll-to) and the amber moved class + a "was" delta. Change the wrapper opening tag to:

```vue
<div
  v-for="c in section.controls" :key="c.key"
  v-show="!(c.key === 'typeWeight' && !fontIsVariable)"
  :data-control-key="c.key"
  :class="{ 'rounded-md ring-1 ring-amber-400/30 px-1 -mx-1': vibeMoved.has(c.key) }"
>
```

And immediately after the existing `<label v-if="c.kind !== 'slider'" ...>{{ c.label }}</label>` line (around line 609), add an amber "was" hint shown only for moved controls:

```vue
<span v-if="vibeMoved.has(c.key) && vibeSnapshot" class="ml-1 text-[10px] text-amber-400/80">was {{ fmt(vibeSnapshot[c.key]) }}</span>
```

> **v1 simplification:** this gives the amber ring + "was X" delta + chips that scroll to the control — the legible core of the approved mockup. The on-track dashed ghost marker (inside `StudioSlider`) is deferred polish to avoid touching the slider primitive in v1.

- [ ] **Step 4: End-to-end verify (screenshots)**

Start ComfyUI + the dev server. Open Type Studio, pick the Extrude effect, type "warmer and heavier" → Apply. Confirm:
1. The preview updates live.
2. The summary header shows N changes + rationale + amber chips.
3. The moved sliders show the amber ring + "was X".
4. Clicking a chip scrolls to that control.
5. Revert restores the preview and clears the header; Keep clears the header and leaves the values.

Capture a screenshot of the proposal state for the record.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(vibe-control): wire copilot into Type Studio (live apply, revert, highlights)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Add `hint`s to the Extrude (boost) controls

**Files:**
- Modify: `frontend/app/lib/spacetype/effects/boost.ts` (its `controls: ControlSpec[]` array)

**Interfaces:**
- Consumes/produces: nothing new — adds optional `hint` strings the descriptor already reads.

- [ ] **Step 1: Add hints to each AI-editable control**

Open `frontend/app/lib/spacetype/effects/boost.ts`. For each `slider`/`select`/`color` entry in its `controls` array, add a `hint` describing the visual effect of higher/lower (or each option). Example shape — adapt to the real keys in that file:

```ts
{ key: 'depth', label: 'Depth', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5,
  hint: 'extrusion depth — higher = thicker/heavier letters' },
{ key: 'extrudePerspective', label: 'Converge', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0,
  hint: 'perspective convergence to a vanishing point — higher = more dramatic depth' },
```

Add a one-line `hint` to every slider/select/color in the effect. Keep each hint short and visual ("higher = …; lower = …" or per-option).

- [ ] **Step 2: Verify hints reach the model**

Restart the dev server, open Type Studio → Extrude, and run a vibe like "subtle and flat" vs "extreme depth". Confirm the proposed changes move the depth/perspective controls sensibly (the hints should make the mapping noticeably better than label-only). Screenshot one before/after.

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/spacetype/effects/boost.ts
git commit -m "feat(vibe-control): add semantic hints to Extrude controls

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §2 decisions (params-only, live proposal, params-only authority, hybrid UX, Type, Haiku, text off-limits) → Tasks 1 (editable-kind filter excludes text), 3 (Haiku), 5–6 (live proposal UX). ✓
- §3.1 `ControlDescriptor` seam → Task 1 (`describeControls`; field named `path` for the future Shader adapter). ✓
- §3.2 AI-editable filter (+ `aiEditable` override) → Task 1 (`isEditable`). ✓
- §3.3 `hint` enrichment → Task 1 (type) + Task 7 (Extrude hints). ✓
- §3.4 patch validation/clamp → Task 1 (`validatePatch`). **Deviation:** validation runs client-side in the composable (Task 4), not in the route — matching the established `usePortIntent`/`validateSuggestion` pattern; the route returns raw `changes`. Functionally equivalent and codebase-consistent. ✓
- §3.5 route mirrors `explain`/`pipeline-suggest` → Task 3. ✓ (Metering/wallet deferred — user confirmed v1 uses the existing user-supplied-key path.)
- §4 hybrid UX (live preview, summary header, chips scroll-to, in-place amber + "was", Keep/Revert) → Tasks 5–6. On-track dashed ghost deferred (noted). ✓
- §5 design-system constraint (Studio primitives, amber/emerald, no purple) → Task 5. ✓
- §6 integration (source from `effect.controls`, `apply` mutates `params`, snapshot/restore) → Task 6. Post-FX inclusion: descriptor sources from `effect.value.controls` only in v1 (post-FX inclusion remains the spec's open task — deferred). The `hydrating` guard is not tripped because `apply` mutates `params` without changing `effectId`/rebuilding; noted. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. Task 7's hint values are illustrative because they depend on the real keys in `boost.ts` — the step instructs adding a short hint to every editable control, with concrete examples.

**Type consistency:** `DescribedControl.path`, `describeControls`, `validatePatch`, `VIBE_SCHEMA`, `buildVibePrompt`, `requestPatch`, the `{ changes: [{key, value}] }` wire shape, and the proposal `chips: {label, before, after, path}` shape are used identically across Tasks 1–6. ✓
