# Text Effect × Font Playground — typography restyle — design

Make the **Text Effect** node able to *transform real typography* instead of only
generating a word from a prompt. Today the Font Playground ([`RenderType`](../../comfy_extras/nodes_type.py#L53))
lets you compose a wordmark — variable font, weight/width/slant axes, size,
colour — and bakes it to a crisp PNG (IMAGE + MASK). But the Text Effect node
([`TextEffectNode`](../../comfy_api_nodes/nodes_replicate.py#L1806)) ignores all
of that: it asks Ideogram to *redraw* the word from a text prompt. So the careful
typographic composition is thrown away.

This change lets you **wire the Font Playground into the Text Effect node** and have
the effect repaint the *exact* letterforms — your font, kerning, spacing, layout
preserved — with the chosen material (liquid chrome, holographic, molten…).

## Decision: restyle the exact letterforms (image-to-image edit)

Three options were considered:

| Option | What it does | Verdict |
|---|---|---|
| **A. Restyle exact letterforms** | Feed the rendered PNG into an image-edit model with the effect as an instruction; preserves the precise glyphs, repaints material only | **Chosen** |
| B. Structure-guided regenerate | Use the silhouette/mask to steer a fresh generation; looser, more dramatic, less faithful | Deferred (see Future) |
| C. Just a text source | Pass only the text string to Ideogram; regenerate from scratch | Rejected — discards the composition, defeating the feature |

**Why A:** typography is the one domain where faithfulness matters most — the exact
letterforms *are* the design, so an effect that warps the kerning or swaps the font
is a regression. A is also the lowest-risk build: the codebase already ships
[`FluxKontextRemoteNode`](../../comfy_api_nodes/nodes_replicate.py#L593), a
"keep the composition, change the look" image editor, and the
[effect catalog](../../comfy_api_nodes/text_effects.py#L34) already encodes the
style vocabulary. A reuses both.

**Known limitation (accepted for v1):** the 16 effects split into *material*
treatments (chrome, holographic, molten, concrete, crystalline, frosted glass…)
that restyle beautifully via an edit, and *dispersion* effects (ink-in-water,
smoke/vapor, light-trails) that want the letters to break apart — which an
exact-preserve edit fights. v1 ships A and serves the material family well;
dispersion effects still work but stay closer to the source than ideal. See Future.

## Architecture — one dual-mode node

A single Text Effect node, two paths, chosen by whether the new optional `image`
input is wired:

```
                              ┌─ image connected ──► RESTYLE mode
Font Playground (RenderType)  │   Flux Kontext edit: repaint the exact
  IMAGE ──────────────────────┤   letterforms with the effect's material
                              │
TextEffect (no image)  ───────└─ image empty ─────► GENERATE mode (today)
                                  Ideogram text-to-image from prompt
```

This mirrors the optional-image-changes-behavior pattern already used by
[`KlingVideoRemoteNode`](../../comfy_api_nodes/nodes_replicate.py#L649)
(text-to-video vs image-to-video on `start_image`).

## Component changes

### 1. `TextEffectNode` — optional image input + dispatch
File: [`comfy_api_nodes/nodes_replicate.py`](../../comfy_api_nodes/nodes_replicate.py#L1806)

- Add `IO.Image.Input("image", optional=True, tooltip="Connect a Font Playground (or any image) to restyle its exact letterforms instead of generating from text.")`.
- `execute(cls, text, effect, aspect_ratio, seed, image=None)` branches:
  - **`image is not None` → restyle:** `input_image = _image_tensor_to_data_url(image)`,
    instruction = `build_edit_prompt(effect, text)`, call
    `_run_prediction("black-forest-labs/flux-kontext-pro", {prompt, input_image, aspect_ratio:"match_input_image", output_format:"png", seed?})`.
    `text` is **optional** here (the word is already in the image), so the
    "Enter some text" guard only applies in generate mode.
  - **`image is None` → generate:** unchanged Ideogram path
    (`build_prompt` + `aspect_ok` + `magic_prompt_option:"Off"`).
- `aspect_ratio` combo applies only to generate mode; restyle uses
  `match_input_image` to preserve the playground's crop.
- Price badge stays ~$0.04 (Kontext Pro ≈ Ideogram v3 turbo).

### 2. Effect catalog — edit phrasing
File: [`comfy_api_nodes/text_effects.py`](../../comfy_api_nodes/text_effects.py#L24)

- Add `edit_template: str` to the `TextEffect` dataclass — describes only the
  *material*, e.g. `"Restyle the letters as flowing liquid chrome — glossy mercury, sharp studio reflections, Y2K aesthetic, dark seamless background."`
- Add a shared `_EDIT_PRESERVE_SUFFIX = "Keep the exact letterforms, spacing, and composition unchanged; restyle only the surface material and lighting."`
- Add `build_edit_prompt(effect_id, text="")` → `f"{eff.edit_template} {_EDIT_PRESERVE_SUFFIX}"`,
  with the same default-effect fallback as `build_prompt`.
- Centralizing the preservation rule keeps all 16 `edit_template` strings short
  and consistent.
- **TS catalog ([`text-effects.ts`](../../frontend/app/data/text-effects.ts)) stays untouched.**
  The gallery only renders CSS previews and never consumes edit phrasing, so
  mirroring `edit_template` into TS would be dead data — an intentional exception
  to the usual "mirror the catalog" rule, noted in the file header comment.

### 3. Font Playground — letter-spacing + kerning
File: [`frontend/app/components/vue-canvas/widgets/WidgetFontPlayground.vue`](../../frontend/app/components/vue-canvas/widgets/WidgetFontPlayground.vue)

- Extend `PlaygroundState` with `letterSpacing: number` (em, scales with font
  size) and `kerning: boolean`. Both round-trip in the existing `params` JSON;
  the Python node ignores them (it only reads `rendered`).
- Live preview: CSS `letter-spacing` (em) + `font-kerning`.
- Bake: `ctx.letterSpacing` (convert em→px against `fontPx`) + `ctx.fontKerning`.
  Both are Chromium-supported and `measureText` already honours `ctx.letterSpacing`,
  so the tight crop in `bakeAndUpload` stays correct.
- UI: a "Spacing" slider (em) + a "Kerning" toggle beside the existing axis
  sliders.

## Data flow

1. Font Playground widget bakes the PNG (now with spacing/kerning) → `/upload/image`.
2. `RenderType.execute` loads it → IMAGE output.
3. User wires `RenderType.image` → `TextEffect.image`. The edge carries
   `dataType: "IMAGE"` and serializes to a LiteGraph link at execute time.
4. `TextEffect.execute` sees `image is not None` → restyle branch → Flux Kontext
   edit → IMAGE output.

The optional IMAGE input renders as a left-side **port** automatically — IMAGE is a
non-widget type in [`useVueNodes`](../../frontend/app/composables/useVueNodes.ts),
so no custom port wiring. **Verify in-browser** that the port appears and connects
for this node's rendered component.

## Error handling

- Restyle + empty text → allowed (the image carries the word).
- Generate + empty text → keep today's `"Enter some text to render."`.
- Unknown effect id → existing fallback to the default effect.
- Kontext / Ideogram API failures and font-bake failures → existing handlers, unchanged.

## Testing

- **Backend:** `py_compile`; import check; assert every effect has a non-empty
  `edit_template`; smoke-test `build_edit_prompt`.
- **Frontend:** dev server — drop a Font Playground + a Text Effect, wire them,
  confirm the IMAGE port appears and connects, confirm the spacing/kerning controls
  change the baked output.
- A real end-to-end render costs ~$0.04 and needs Replicate creds; verify wiring/UI
  without spending unless a paid round-trip is explicitly wanted.
- **ComfyUI restart** required to pick up the Python changes (nodes are not hot-reloaded).

## Out of scope / future

- **Option B "freedom" dial** — a single control sliding from exact-restyle toward
  structure-guided regeneration, so dispersion effects (ink/smoke/light-trails)
  can break the letters apart. Build only once A proves out.
- Per-effect model routing (some effects on a different edit/generate model).
- Gallery preview reacting to a connected image (show the real type instead of the
  CSS approximation).
