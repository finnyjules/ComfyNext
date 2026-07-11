# Kinetic Slates Phase 2 — Slate Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six LIV-style motion slate templates — brand-token-driven, instantiated from a gallery into ordinary animated Frame nodes — so a user fills text/media slots and gets a broadcast-grade branded slate clip with zero animation work.

**Architecture:** A slate template is data: token-bearing layer definitions (`{{ brand.* }}` for colors/fonts via the shipped brand library, `{{ props.* }}` for user text slots) + per-layer `LayerAnimation` choreography + `FrameMotion`. A pure `instantiateSlate()` resolves tokens through the existing `resolveTokens` + `effectiveBrand` and emits concrete `LocalLayer[]` — a placed slate is a plain editable Frame, no live template link. The gallery follows the Film-a-Shot preset-modal pattern; placement rides the existing `sailor:addNode` event with a new optional properties payload.

**Tech Stack:** Vue 3 + TS (Nuxt 4), the Phase 1 motion engine (`frontend/app/lib/motion/`), brand library (`frontend/shared/brand/`), vitest.

**Specs:** docs/superpowers/specs/2026-06-10-kinetic-slates-design.md (template system section) + docs/superpowers/specs/2026-06-10-brand-library-design.md (consumers section).

**Conventions binding every task:**
- Work on branch **main** directly. TREE SANITY GUARD for every task: verify `git branch --show-current` == main AND the prior tasks' files exist before starting and again before committing (a parallel session switches this checkout sometimes — if the tree looks wrong, STOP and report BLOCKED; never recreate missing files). Stage only your own files.
- Tests: `cd frontend && npx vitest run tests/unit`. Dev servers supervised: Nuxt :3002, ComfyUI :8188.
- Geometry conventions are `useCompositorLayers.ts`'s: x/y normalized centers, sizes normalized to canvas WIDTH.

---

### Task 1: Slate template types + instantiation resolver (TDD)

**Files:**
- Create: `frontend/app/lib/slates/types.ts`
- Create: `frontend/app/lib/slates/instantiate.ts`
- Test: `frontend/tests/unit/slate-instantiate.unit.spec.ts`

- [ ] **Step 1: types.ts**

```ts
// frontend/app/lib/slates/types.ts
/**
 * Slate templates — data-only definitions of LIV-style motion compositions.
 * Layer defs carry tokens: `{{ brand.<key> }}` (resolved from the project's
 * active brand kit via effectiveBrand) and `{{ props.<slotKey> }}` (user text
 * slots). instantiate.ts resolves them into plain LocalLayers + FrameMotion —
 * a placed slate is an ordinary editable Frame with concrete values.
 */
import type { LayerAnimation, FrameMotion } from '~/lib/motion/types'

/** Gradient def whose stop colors may be tokens. */
export interface SlateGradientDef {
  type: 'linear' | 'radial'
  angle?: number
  stops: { offset: number; color: string }[]
}
export type SlatePaintDef = string | SlateGradientDef

interface SlateLayerCommon {
  /** Template-local reference key — mask bindings use this, instantiation maps it to a real layer id. */
  ref: string
  x: number; y: number
  rotation?: number
  opacity?: number
  /** Clip this layer to another def's silhouette (by ref). */
  maskedByRef?: string
  animation?: LayerAnimation
}

export interface SlateTextDef extends SlateLayerCommon {
  kind: 'text'
  text: string            // may contain {{ props.* }} / {{ brand.* }} tokens
  fontFamily: string      // may be a {{ brand.fontDisplay }} token
  fontWeight: number
  fontSize: number
  color: string           // may be a token
  align?: 'left' | 'center' | 'right'
  lineHeight?: number
  strokeColor?: string
  strokeWidth?: number
}

export interface SlateRectDef extends SlateLayerCommon {
  kind: 'rect'
  w: number; h: number
  radius?: number
  fill: SlatePaintDef
}

export interface SlateMediaDef extends SlateLayerCommon {
  kind: 'media'
  /** Media slot key — the gallery fills it with an uploaded image filename. */
  slot: string
  w: number; h: number
  /** Fallback when the slot is unfilled: a rect with this fill stands in. */
  fallbackFill: SlatePaintDef
}

export type SlateLayerDef = SlateTextDef | SlateRectDef | SlateMediaDef

export interface SlateTextSlot { key: string; label: string; default: string }
export interface SlateMediaSlot { key: string; label: string }

export interface SlateTemplate {
  id: string
  label: string
  pitch: string           // one-line description for the gallery card
  motion: FrameMotion
  textSlots: SlateTextSlot[]
  mediaSlots: SlateMediaSlot[]
  layers: SlateLayerDef[]
  /** Three colors for the gallery card thumbnail (token strings). */
  thumb: [string, string, string]
}

export interface SlateMediaFill { filename: string; aspect: number }

export interface InstantiateOptions {
  brand: import('~~/shared/brand/types').BrandKit
  texts: Record<string, string>
  media?: Record<string, SlateMediaFill>
}
```

- [ ] **Step 2: failing test**

```ts
// frontend/tests/unit/slate-instantiate.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { instantiateSlate } from '../../app/lib/slates/instantiate'
import type { SlateTemplate } from '../../app/lib/slates/types'

const T: SlateTemplate = {
  id: 't', label: 'T', pitch: '', motion: { fps: 30, duration: 4 },
  textSlots: [{ key: 'title', label: 'Title', default: 'HELLO' }],
  mediaSlots: [{ key: 'photo', label: 'Photo' }],
  thumb: ['{{ brand.primary }}', '{{ brand.accent }}', '{{ brand.accent2 }}'],
  layers: [
    { ref: 'mask', kind: 'text', text: '{{ props.title }}', fontFamily: '{{ brand.fontDisplay }}',
      fontWeight: 900, fontSize: 0.2, color: '#ffffff', x: 0.5, y: 0.5 },
    { ref: 'panel', kind: 'media', slot: 'photo', x: 0.5, y: 0.5, w: 0.5, h: 0.5,
      maskedByRef: 'mask',
      fallbackFill: { type: 'linear', angle: 45, stops: [
        { offset: 0, color: '{{ brand.accent }}' }, { offset: 1, color: '{{ brand.accent2 }}' },
      ] },
      animation: { offset: 0.5, in: { presetId: 'grow-in', duration: 0.6 } } },
  ],
}
const BRAND = { accent: '#A3E635', accent2: '#22D3EE', fontDisplay: 'Archivo Black' }

describe('instantiateSlate', () => {
  it('resolves brand and slot tokens into concrete layers', () => {
    const { layers, motion } = instantiateSlate(T, { brand: BRAND, texts: { title: 'ADELAIDE' } })
    expect(motion).toEqual({ fps: 30, duration: 4 })
    const text = layers[0] as any
    expect(text.kind).toBe('text')
    expect(text.text).toBe('ADELAIDE')
    expect(text.fontFamily).toBe('Archivo Black')
  })
  it('maps maskedByRef to the generated layer id', () => {
    const { layers } = instantiateSlate(T, { brand: BRAND, texts: { title: 'X' } })
    expect((layers[1] as any).maskedById).toBe((layers[0] as any).id)
  })
  it('unfilled media slot becomes a rect with the resolved fallback gradient', () => {
    const { layers } = instantiateSlate(T, { brand: BRAND, texts: { title: 'X' } })
    const panel = layers[1] as any
    expect(panel.kind).toBe('rect')
    expect(panel.fill.stops.map((s: any) => s.color)).toEqual(['#A3E635', '#22D3EE'])
    expect(panel.animation?.in?.presetId).toBe('grow-in')
  })
  it('filled media slot becomes an image layer with the filename', () => {
    const { layers } = instantiateSlate(T, {
      brand: BRAND, texts: { title: 'X' },
      media: { photo: { filename: 'up.png', aspect: 1.5 } },
    })
    const panel = layers[1] as any
    expect(panel.kind).toBe('image')
    expect(panel.filename).toBe('up.png')
    expect(panel.maskedById).toBe((layers[0] as any).id)
  })
  it('missing slot text falls back to the slot default', () => {
    const { layers } = instantiateSlate(T, { brand: BRAND, texts: {} })
    expect((layers[0] as any).text).toBe('HELLO')
  })
  it('unresolvable brand tokens fall back to a visible neutral, not the raw token', () => {
    const { layers } = instantiateSlate(T, { brand: {}, texts: { title: 'X' } })
    expect((layers[0] as any).fontFamily).not.toContain('{{')
  })
})
```

- [ ] **Step 3:** run → FAIL (module not found).

- [ ] **Step 4: instantiate.ts**

```ts
// frontend/app/lib/slates/instantiate.ts
import {
  createTextLayer, createRectLayer, createImageLayer, type LocalLayer,
} from '~/composables/useCompositorLayers'
import type { Gradient } from '~/composables/useCompositorLayers'
import { resolveTokens } from '~~/shared/template-grid/tokens'
import type { BrandKit } from '~~/shared/brand/types'
import type { FrameMotion } from '~/lib/motion/types'
import type {
  SlateTemplate, SlateLayerDef, SlatePaintDef, InstantiateOptions,
} from './types'

/** Token-resolve fallbacks: unresolved brand roles get visible neutrals so a
 *  kit-less instantiation still renders (resolveTokens returns the raw token
 *  for whole-string misses, which must never reach a canvas font/color). */
const NEUTRALS: Record<string, string> = {
  primary: '#111113', secondary: '#3f3f46', accent: '#a3e635', accent2: '#22d3ee',
  foreground: '#ffffff', background: '#0a0a0a', fontDisplay: 'Inter', fontBody: 'Inter',
}

function resolveStr(value: string, texts: Record<string, string>, brand: BrandKit): string {
  const out = resolveTokens(value, texts, brand as Record<string, unknown>)
  const miss = /^\{\{\s*brand\.(\w+)\s*\}\}$/.exec(String(out))
  if (miss) return NEUTRALS[miss[1]] ?? '#888888'
  return String(out)
}

function resolvePaint(p: SlatePaintDef, texts: Record<string, string>, brand: BrandKit): string | Gradient {
  if (typeof p === 'string') return resolveStr(p, texts, brand)
  return {
    type: p.type, angle: p.angle ?? 0,
    stops: p.stops.map(s => ({ offset: s.offset, color: resolveStr(s.color, texts, brand) })),
  } as Gradient
}

export function instantiateSlate(
  template: SlateTemplate,
  opts: InstantiateOptions,
): { layers: LocalLayer[]; motion: FrameMotion } {
  const texts: Record<string, string> = {}
  for (const slot of template.textSlots) texts[slot.key] = opts.texts[slot.key]?.trim() || slot.default
  const brand = opts.brand

  // First pass: create layers, remember ref → id for mask binding.
  const idByRef = new Map<string, string>()
  const layers: LocalLayer[] = template.layers.map((def: SlateLayerDef) => {
    const common = {
      x: def.x, y: def.y, rotation: def.rotation ?? 0, opacity: def.opacity ?? 1,
      animation: def.animation ? structuredClone(def.animation) : undefined,
    }
    let layer: LocalLayer
    if (def.kind === 'text') {
      layer = createTextLayer({
        ...common,
        text: resolveStr(def.text, texts, brand),
        fontFamily: resolveStr(def.fontFamily, texts, brand),
        fontWeight: def.fontWeight,
        fontSize: def.fontSize,
        color: resolveStr(def.color, texts, brand),
        align: def.align ?? 'center',
        lineHeight: def.lineHeight ?? 1.1,
        strokeColor: def.strokeColor ? resolveStr(def.strokeColor, texts, brand) : '#000000',
        strokeWidth: def.strokeWidth ?? 0,
      })
    } else if (def.kind === 'rect') {
      layer = createRectLayer({
        ...common, w: def.w, h: def.h, radius: def.radius ?? 0,
        fill: resolvePaint(def.fill, texts, brand),
      })
    } else {
      const fill = opts.media?.[def.slot]
      layer = fill
        ? createImageLayer(fill.filename, fill.aspect, { ...common, w: def.w })
        : createRectLayer({ ...common, w: def.w, h: def.h, radius: 0, fill: resolvePaint(def.fallbackFill, texts, brand) })
    }
    idByRef.set(def.ref, layer.id)
    return layer
  })

  // Second pass: bind masks by ref.
  template.layers.forEach((def, i) => {
    if (def.maskedByRef) {
      const id = idByRef.get(def.maskedByRef)
      if (id) (layers[i] as { maskedById?: string }).maskedById = id
    }
  })

  return { layers, motion: { ...template.motion } }
}
```

NOTE: `resolveTokens(value, props, brand)` — its `props` scope serves the text slots, so defs write `{{ props.title }}`. Verify `Gradient`/factory exports against `useCompositorLayers.ts` (they exist: isGradient/LinearGradient ~line 22, factories ~line 220+, createImageLayer(filename, aspect, partial)).

- [ ] **Step 5:** tests PASS, full suite green. Commit:

```bash
git add frontend/app/lib/slates/ frontend/tests/unit/slate-instantiate.unit.spec.ts
git commit -m "Slates: template types + token instantiation resolver"
```

---

### Task 2: The six LIV-style template definitions

**Files:**
- Create: `frontend/app/data/slate-templates.ts`
- Test: `frontend/tests/unit/slate-templates.unit.spec.ts`

The choreography reference is `frontend/app/data/dev-slate-fixture.ts` (the Phase 1 acceptance slate) — event-slate is its tokenized evolution. All animation preset ids MUST come from `SUPPORTED_IN_IDS` / `SUPPORTED_OUT_IDS` / `SUPPORTED_LOOP_IDS` (`frontend/app/lib/motion/evaluate.ts`) — the test enforces this.

- [ ] **Step 1: failing test**

```ts
// frontend/tests/unit/slate-templates.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { SLATE_TEMPLATES, SLATE_TEMPLATES_BY_ID } from '../../app/data/slate-templates'
import { instantiateSlate } from '../../app/lib/slates/instantiate'
import { SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS } from '../../app/lib/motion/evaluate'

const BRAND = { primary: '#0a0a0a', accent: '#A3E635', accent2: '#22D3EE', foreground: '#ffffff', fontDisplay: 'Archivo Black', fontBody: 'Inter' }

describe('slate template catalog', () => {
  it('ships the six LIV primitives', () => {
    expect(SLATE_TEMPLATES.map(t => t.id).sort()).toEqual([
      'event-slate', 'keyline-trace', 'lower-third', 'marquee-band', 'metadata-grid', 'photo-mask-punch',
    ])
  })
  it('every template instantiates without raw tokens leaking', () => {
    for (const t of SLATE_TEMPLATES) {
      const { layers } = instantiateSlate(t, { brand: BRAND, texts: {} })
      expect(layers.length).toBeGreaterThan(0)
      for (const l of layers) {
        expect(JSON.stringify(l)).not.toContain('{{')
      }
    }
  })
  it('every animation preset id is supported by the engine', () => {
    for (const t of SLATE_TEMPLATES) {
      for (const def of t.layers) {
        if (def.animation?.in) expect(SUPPORTED_IN_IDS).toContain(def.animation.in.presetId)
        if (def.animation?.out) expect(SUPPORTED_OUT_IDS).toContain(def.animation.out.presetId)
        if (def.animation?.loop) expect(SUPPORTED_LOOP_IDS).toContain(def.animation.loop.presetId)
      }
    }
  })
  it('every text slot is consumed by at least one layer', () => {
    for (const t of SLATE_TEMPLATES) {
      const blob = JSON.stringify(t.layers)
      for (const slot of t.textSlots) expect(blob).toContain(`{{ props.${slot.key} }}`)
      for (const slot of t.mediaSlots) {
        expect(t.layers.some(l => l.kind === 'media' && l.slot === slot.key)).toBe(true)
      }
    }
  })
  it('lookup map matches the list', () => {
    expect(Object.keys(SLATE_TEMPLATES_BY_ID).length).toBe(SLATE_TEMPLATES.length)
  })
})
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: the catalog.** Create `frontend/app/data/slate-templates.ts`. Shared tokens: `const ACC = '{{ brand.accent }}'`, `ACC2 = '{{ brand.accent2 }}'`, `FG = '{{ brand.foreground }}'`, `BG = '{{ brand.primary }}'`, `FONT = '{{ brand.fontDisplay }}'`, `FONT_BODY = '{{ brand.fontBody }}'`, and `const GRAD = { type: 'linear' as const, angle: 0, stops: [{ offset: 0, color: ACC }, { offset: 1, color: ACC2 }] }`. The six templates (all `motion: { fps: 30, duration: 4 }` unless stated):

**1. `event-slate`** — tokenized dev-slate-fixture. textSlots: title ('ADELAIDE'), date ('14–16 FEB'), venue ('THE GRANGE GOLF CLUB'), micro ('WATCH LIVE — 2025'). mediaSlots: []. Layers (same geometry/choreography as the fixture):
- rect `bar` x .5 y .532 w .46 h .085 fill GRAD, anim {offset .25, in slide-right .5/0, out fade-out .4/0}
- text `city` `{{ props.title }}` x .5 y .42 size .11 w900 FONT color FG, anim {offset 0, in mask-up .7/.035, out slide-out-up .45/.02}
- text `date` `{{ props.date }}` x .5 y .535 size .055 w800 FONT color BG, anim {offset .45, in slide-up .5/.03, out fade-out .35/.02}
- text `venue` `{{ props.venue }}` x .5 y .63 size .034 w700 FONT_BODY color ACC, anim {offset .65, in fade-in .5/.015, out fade-out .35/0}
- text `micro` `{{ props.micro }}` x .5 y .92 size .018 w600 FONT_BODY color ACC, anim {offset .9, in typewriter .6/.02, loop glitch-loop 1.2/.01}
thumb: [BG, ACC, ACC2]

**2. `photo-mask-punch`** — textSlots: word ('25'). mediaSlots: photo ('Photo / video still'). Layers:
- text `maskWord` `{{ props.word }}` x .5 y .5 size .42 w900 FONT color FG (no animation — static mask)
- media `photo` slot 'photo' x .5 y .5 w .9 h .9 maskedByRef 'maskWord', fallbackFill GRAD, anim {offset 0, in grow-in .7/0, loop breathe 3/0, out fade-out .5/0}
- text `caption` `{{ props.word }}` x .5 y .9 size .03 w700 FONT_BODY color ACC, anim {offset .5, in fade-in .4/.02, out fade-out .3/0}
thumb: [ACC2, FG, ACC]

**3. `marquee-band`** — textSlots: phrase ('LIV GOLF'). motion duration 6. Layers: three full-width bands; each = rect (y .25/.5/.75, w 1.6, h .18; fills ACC / BG / ACC2) + a text on it (`{{ props.phrase }}  {{ props.phrase }}  {{ props.phrase }}` — repeat inline for tiling width, size .09 w900 FONT, colors BG / FG / BG) with `anim {offset 0, loop marquee 3/0}` and alternating direction faked by rotation: 0 for all (direction variety deferred — marquee sweeps +→−; acceptable v1, note in pitch). Bands' rects static.
thumb: [ACC, BG, ACC2]

**4. `lower-third`** — textSlots: name ('JON RAHM'), role ('LEGION XIII — CAPTAIN'). Layers:
- rect `bar` x .26 y .82 w .42 h .075 fill GRAD, anim {offset 0, in slide-right .45/0, out slide-out-left .4/0}
- text `name` `{{ props.name }}` x .26 y .815 size .034 w900 FONT color BG align left, anim {offset .2, in mask-up .4/.02, out fade-out .3/.01}
- text `role` `{{ props.role }}` x .26 y .875 size .02 w600 FONT_BODY color FG align left, anim {offset .4, in slide-up .4/.015, out fade-out .3/0}
thumb: [ACC, ACC2, FG]

**5. `keyline-trace`** — textSlots: word ('LEGION'). Layers (outline draws, then fill snaps):
- text `outline` `{{ props.word }}` x .5 y .5 size .18 w900 FONT color 'transparent' strokeColor ACC strokeWidth .003, anim {offset 0, in mask-up 1.0/.05, loop float 3/.02}
- text `fill` `{{ props.word }}` x .5 y .5 size .18 w900 FONT color FG, anim {offset 1.1, in appear .3/.02, out fade-out .4/.02}
thumb: [BG, ACC, FG]

**6. `metadata-grid`** — textSlots: line1 ('ADELAIDE — FEB 14-16'), line2 ('THE GRANGE GOLF CLUB'), line3 ('13 TEAMS — 2025'). motion duration 6. Layers: 6 microtype texts (two columns x .15/.85; rows y .15/.5/.85; size .016 w600 FONT_BODY color ACC; texts cycling `{{ props.line1 }}`/`{{ props.line2 }}`/`{{ props.line3 }}`), each anim {offset i*.15, in typewriter .5/.02, loop glitch-loop 1.5/.01} — plus a center text `{{ props.line1 }}` y .5 x .5 size .04 w800 FONT color FG anim {offset .3, in mask-up .6/.03, loop float 4/.03}.
thumb: [BG, ACC, ACC2]

Export `SLATE_TEMPLATES: SlateTemplate[]` and `SLATE_TEMPLATES_BY_ID` (Object.fromEntries). Each template's `pitch` is one editorial line (e.g. event-slate: "City, date, venue — the broadcast intro card.").

- [ ] **Step 4:** tests PASS + full suite. (If `keyline-trace`'s `color: 'transparent'` renders a fill in canvas, check `drawText` — it always fills; 'transparent' fillStyle paints nothing, which is the intent. Confirm visually in Task 5.)

- [ ] **Step 5: commit**

```bash
git add frontend/app/data/slate-templates.ts frontend/tests/unit/slate-templates.unit.spec.ts
git commit -m "Slates: six LIV-style template definitions"
```

---

### Task 3: Slate gallery modal

**Files:**
- Create: `frontend/app/components/vue-canvas/SlateGalleryModal.vue`

Pattern source: `frontend/app/components/vue-canvas/ShotPresetGalleryModal.vue` (read fully — grid of preset cards, search/filter, emit on pick; copy its container/card styling). This modal adds a second pane: slot filling.

- [ ] **Step 1: build the component.** Props `{ activeKit?: BrandKit | null }`; emits `{ close: [], create: [payload: { layers: LocalLayer[]; motion: FrameMotion }] }`. Internal state: `selectedId` (template), `texts: Record<string,string>`, `media: Record<string, SlateMediaFill>`. Left pane: template cards — name, pitch, and a thumbnail built from the template's `thumb` colors resolved against `activeKit ?? {}` via the same NEUTRALS fallback (import `instantiateSlate`? No — export `resolveStr`-equivalent: add `export function resolveThumb(colors: [string,string,string], brand: BrandKit): string[]` to `frontend/app/lib/slates/instantiate.ts` reusing its internal resolver, and import it here). Card thumb: three stacked color bars (CSS only). Right pane (when selected): one text input per `textSlots` (placeholder = default), one file input per `mediaSlots` uploading via the `/upload/image` pattern (copy from `frontend/app/components/brand/KitPanel.vue` `onLogoFile`, but store `{ filename, aspect }` — compute aspect from an Image() load of the uploaded file before storing), and a "Create slate" button:

```ts
function create() {
  const t = SLATE_TEMPLATES_BY_ID[selectedId.value!]
  if (!t) return
  emit('create', instantiateSlate(t, { brand: props.activeKit ?? {}, texts: texts.value, media: media.value }))
}
```

- [ ] **Step 2: compile smoke** — `npx vitest run tests/unit` + `npx vue-tsc --noEmit 2>&1 | grep -i slate` (no new errors).

- [ ] **Step 3: commit**

```bash
git add frontend/app/components/vue-canvas/SlateGalleryModal.vue
git commit -m "Slates: gallery modal with brand-aware thumbnails + slot filling"
```

---

### Task 4: Canvas entry point — Add → Slate

**Files:**
- Modify: `frontend/app/layouts/default.vue` (~line 107: the Add-menu items array; plus modal mount + handler)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (`handleAddNode` ~line 1974-2040: optional properties payload)

- [ ] **Step 1: extend the addNode event.** Read `handleAddNode` in VueNodeCanvas.vue. The Add menu (default.vue:107 `{ label: 'Frame', nodeType: 'Compositor' }`) dispatches `sailor:addNode`. Extend the event detail with optional `properties?: Record<string, unknown>`: in `handleAddNode`, after the node is created, `Object.assign(node.data.properties ||= {}, detail.properties ?? {})` (match the actual node-object shape used there — read how the created node's `data.properties` is initialized; if creation is async/deferred, apply properties at the same place position/type are applied).

- [ ] **Step 2: Add-menu item + modal.** In default.vue: add `{ label: 'Slate', icon: Clapperboard, special: 'slate-gallery' }` after the Frame item (import Clapperboard from lucide; read how menu items dispatch — if items are pure nodeType dispatchers, add a special-case branch that opens the gallery instead). Mount:

```vue
<SlateGalleryModal
  v-if="slateGalleryOpen"
  :active-kit="brandLib.activeKit.value ?? null"
  @close="slateGalleryOpen = false"
  @create="onCreateSlate"
/>
```

```ts
const slateGalleryOpen = ref(false)
function onCreateSlate(payload: { layers: unknown[]; motion: unknown }) {
  slateGalleryOpen.value = false
  window.dispatchEvent(new CustomEvent('sailor:addNode', {
    detail: {
      nodeType: 'Compositor',
      properties: {
        sailor_localLayers: payload.layers,
        sailor_motion: payload.motion,
      },
      // + whatever positioning fields the existing dispatch includes — copy them
    },
  }))
}
```

(Match the existing dispatch's detail shape exactly — read the Frame item's path from menu click to dispatch.)

- [ ] **Step 3: browser verification** (Chrome MCP, :3002; ComfyUI :8188 must be up; localStorage VueNodes flag): Add → Slate → gallery shows 6 cards with brand-colored thumbs (LIV Test kit active ⇒ lime/cyan) → pick "Event slate" → set title "ADELAIDE" → Create → a Frame node appears with the slate layers visible → open the modal → Motion → Play: themed choreography plays (lime gradient bar, brand font). Screenshot mid-animation. Console clean.

- [ ] **Step 4: full suite + commit**

```bash
git add frontend/app/layouts/default.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "Slates: Add-menu entry creating pre-animated Frame nodes"
```

---

### Task 5: Acceptance — all six templates

No new files (fixes excepted). In the browser, with kit "LIV Test" active:

- [ ] **Step 1:** Instantiate each of the 6 templates (default slot texts fine) → play each in Motion preview. Per template verify: tokens resolved (brand colors/fonts visible), choreography reads as designed (event-slate = fixture rhythm; photo-mask-punch = gradient/photo INSIDE the word silhouette breathing; marquee = three bands sweeping; lower-third = bar+name+role staggered; keyline-trace = outline reveals then fill appears at 1.1s; metadata-grid = microtype typing + jitter). Screenshot each (6 total).
- [ ] **Step 2:** photo-mask-punch with an actual uploaded image in the media slot — image masked by the word.
- [ ] **Step 3:** Bake event-slate (transport → Bake) → run the graph → Compositor video output exists (history success).
- [ ] **Step 4:** Switch the active kit (Alt/red) → instantiate event-slate again → red themed (re-instantiation re-themes; placed slates keep their colors — expected).
- [ ] **Step 5:** Any visual defects found: fix if small (template data tweaks are cheap), report if structural. Full suite green. Commit any tweaks:

```bash
git add frontend/app/data/slate-templates.ts <other touched files>
git commit -m "Slates: acceptance pass tweaks"
```

---

## Out of scope (per spec)

Re-theming placed slates ("re-apply brand" action), template sharing/saving custom templates, video media slots (image only — video-in-type is Phase 3), AI slot filling, timeline "Add slate" button.

## Risks

- **Marquee tiling width** is approximated by repeating the phrase inline; very short phrases leave gaps at band edges. Acceptable v1; note in the template pitch.
- **'transparent' fill on keyline-trace** relies on canvas fillStyle 'transparent' painting nothing — verify visually in Task 5 (fallback: color = '#00000000').
- **createImageLayer aspect** must be computed at upload time in the gallery (Image() load) — don't default to square or photos distort.
- **Parallel session:** tree guard every task; stage only your own files.
