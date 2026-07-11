# Voice preview gallery for the Generate speech node

**Date:** 2026-06-13
**Status:** Approved design, pending implementation plan

## Problem

The **Generate speech** node (`GenerateSpeechNode`, MiniMax Speech-02 HD) exposes a
`voice_id` dropdown with 17 system voices (`Wise_Woman`, `Friendly_Person`,
`Deep_Voice_Man`, …). Today it renders as a bare `<select>` ([WidgetCombo.vue]).
A user picking a voice has no way to hear it before running the node — selecting a
voice is guesswork, and the only way to audition is to run a paid generation.

We want a way to **listen to a voice while selecting it**, reusing the existing
gallery infrastructure.

## Decisions (settled during brainstorming)

1. **Preview audio source: bake once, host static.**
   MiniMax does *not* publish hot-linkable samples for these 17 *system* voice IDs.
   Their public Voice Library (`minimax.io/audio/voices`) is a different voice
   namespace (community/branded voices like "Aussie Bloke"), previews appear to
   require sign-in, and no stable per-voice CDN/file URL is exposed. Hot-linking
   would be the wrong voices and a fragile third-party dependency.
   Instead: generate one short clip per voice **once** via the real API, commit the
   17 mp3s as static frontend assets. Previews are then free, instant, and exactly
   what the user will hear.

2. **UI surface: voice gallery modal**, reusing `CatalogModal` exactly like
   `ModelGalleryModal`. Browse-and-audition (play any voice without committing the
   selection) is the whole point, so a modal grid beats an inline play button.

3. **Sample phrase (one line, spoken by every voice):**
   `"Hi there — this is what I sound like."` — short (~2s), friendly, voice-neutral.

4. **Bake run:** the bake script runs automatically *if* a Replicate API token is
   present in the environment; otherwise the user runs it manually. Either way the
   generated mp3s are committed to the repo.

## Architecture

Data stays a plain `voice_id` string end-to-end; only the *rendering* of that combo
changes. This mirrors the established `lora_picker` / `model_picker` pattern.

```
Generate speech node
  voice_id (Combo, string)  ──marked sailor_widget:"voice_picker"──┐
                                                                       │
ComfyNodeWidget.vue ── v-else-if voice_picker ──► WidgetVoicePicker.vue (launcher button)
                                                          │ dispatch window CustomEvent
                                                          ▼  'sailor:openVoiceGallery'
VueNodeCanvas.vue ── handleOpenVoiceGallery ──► VoiceGalleryModal.vue
                                                          │ wraps CatalogModal
                                                          │ items = voiceCatalog ∩ node options
                                                          │ #card: name + category tag + ▶ play
                                                          │ one shared <audio>, one-at-a-time
                                                          ▼ confirm
                                                  update:modelValue → node widgetsValues
```

### Components & changes

**1. Backend — mark the combo (1 line).**
`comfy_api_nodes/nodes_replicate.py`, `GenerateSpeechNode.define_schema`: add
`extra_dict={"sailor_widget": "voice_picker"}` to the `voice_id`
`IO.Combo.Input`. The combo continues to serialize the plain string, so existing
workflows and the backend execute path are unchanged.

**2. Bake script — `scripts/bake_voice_samples.py` (one-time).**
- Iterates `_MINIMAX_VOICES` (the canonical 17 IDs, imported from
  `nodes_replicate.py` so the list can't drift).
- For each, calls MiniMax speech-02-hd via the same Replicate plumbing the node
  uses, with the fixed phrase, default speed/emotion.
- Writes `frontend/public/voice-samples/<voice_id>.mp3`.
- Idempotent: skips a voice whose mp3 already exists (so re-runs are cheap and a
  partial failure can resume). A `--force` flag re-bakes all.
- Reads the Replicate token from the existing env/config the backend already uses.
  If absent, prints clear instructions and exits non-zero (no crash, no partial
  spend surprise).
- Cost guard: logs the per-voice + total estimated cost before starting.

**3. Voice catalog — `frontend/app/lib/voiceCatalog.ts`.**
Single static frontend source for card display:
```ts
interface VoiceMeta { id: string; label: string; category: 'Female' | 'Male' | 'Character'; sampleUrl: string }
```
- `label`: humanized id (`Wise_Woman` → "Wise Woman", `Sweet_Girl_2` → "Sweet Girl 2",
  `Inspirational_girl` → "Inspirational Girl").
- `category`: hand-assigned per id (Female / Male / Character) for filter chips.
  Initial mapping:
  - Female: Wise_Woman, Calm_Woman, Lovely_Girl, Inspirational_girl, Lively_Girl,
    Sweet_Girl_2, Exuberant_Girl
  - Male: Deep_Voice_Man, Casual_Guy, Patient_Man, Determined_Man, Decent_Boy,
    Elegant_Man, Imposing_Manner
  - Character: Friendly_Person, Young_Knight, Abbess
- `sampleUrl`: `/voice-samples/${id}.mp3`.
- Exported helpers: `voiceMetaFor(id)` (with humanized fallback for unknown ids) and
  `voicesForOptions(options: string[])` (intersection preserving the catalog's order,
  appending any unknown option ids as preview-less entries).

**4. Launcher — `frontend/app/components/vue-canvas/widgets/WidgetVoicePicker.vue`.**
Mirrors `WidgetVoicePicker` ≈ `WidgetLoraPicker`: a node-body button showing a mic
icon + the current voice's humanized label (or "Choose a voice"). On click dispatches
`window` CustomEvent `sailor:openVoiceGallery` with
`{ nodeId, widgetName, options }`. Owns its own label; `nopan nodrag` so it doesn't
drag the canvas.

**5. Render dispatch — `ComfyNodeWidget.vue`.**
Add a branch alongside the other pickers (near line 429):
```html
<template v-else-if="widgetDef.sailor_widget === 'voice_picker'">
  <VueCanvasWidgetsWidgetVoicePicker
    :model-value="modelValue" :node-id="nodeId"
    :widget-name="widgetDef.name" :options="widgetDef.options || []"
    @update:model-value="emit('update:modelValue', $event)" />
</template>
```

**6. Gallery modal — `frontend/app/components/vue-canvas/VoiceGalleryModal.vue`.**
Wraps `CatalogModal` (props: open, title "Choose a voice", items, selectedId,
filters, confirmLabel "Use voice"):
- `items` = `voicesForOptions(options)` from the open event.
- `filters` = category chips: All / Female / Male / Character.
- `#card` slot: voice label, category tag, and a ▶ / ❚❚ **play button**. Clicking play
  auditions `sampleUrl` *without* changing the selection. The active card shows a
  playing state.
- Selecting a card (or confirm) emits the chosen `voice_id` back via the node store /
  `update:modelValue` for `widgetName` on `nodeId`.
- Cards whose `sampleUrl` 404s (or unknown ids with no sample) render the play button
  disabled with a "no preview" affordance.

**7. Modal mount + open handler — `VueNodeCanvas.vue`.**
- Add `<VueCanvasVoiceGalleryModal … />` alongside the other gallery modals (~line 4482).
- Add `handleOpenVoiceGallery(e)` that reads `{ nodeId, widgetName, options }` and
  opens the modal; register/unregister the `sailor:openVoiceGallery` listener next
  to the existing `sailor:openLoraGallery` wiring (lines ~2065 / ~2092).

### Audio playback

Single-element, one-at-a-time, lives inside `VoiceGalleryModal`:
- One `HTMLAudioElement` (a `ref`). `play(id)` sets `src = sampleUrl(id)` and plays;
  starting a new one implicitly stops the previous (same element). `stop()` pauses.
- Track `playingId` for the card UI state. `ended` → clear `playingId`.
- On modal close/unmount: pause + clear, so audio never leaks past the modal.
- `error` on the audio element → mark that voice preview-unavailable for the session.

No `audioEngine.ts` (timeline engine) involvement — that's for synchronized multi-track
playback and is the wrong tool here.

## Error handling

- **Missing sample mp3 (404):** card play button disabled, labelled "no preview";
  selection still works. The voice is still fully usable at run time.
- **Unknown voice id** (in node options but absent from catalog): selectable with a
  humanized label, no preview.
- **Bake script, no token:** clear message + non-zero exit, no partial spend.
- **Bake script, partial run:** idempotent skip-existing means a re-run completes the
  set without re-charging for already-baked voices.

## Testing

- **Unit (vitest, already configured — see `frontend/tests/unit/`):**
  `voiceCatalog`: humanization of representative ids, category assignment,
  `voicesForOptions` intersection/ordering and unknown-id passthrough, `sampleUrl`
  shape.
- **Manual / preview pass:** open the Generate speech node → click the Voice id field
  → modal opens with cards → play several voices (only one plays at a time) → pick one
  → modal closes, node shows the chosen voice → confirm the workflow serializes the
  plain `voice_id` string unchanged.

## Out of scope (YAGNI)

- Live "preview with my own text" generation (was offered, not chosen).
- Voice search box (17 voices fit on one screen; category chips suffice).
- Per-voice waveforms / rich audio visualizers.
- Surfacing this picker on any node other than Generate speech.

## Files touched

| File | Change |
| --- | --- |
| `comfy_api_nodes/nodes_replicate.py` | mark `voice_id` combo `sailor_widget:"voice_picker"` |
| `scripts/bake_voice_samples.py` | new — one-time sample bake |
| `frontend/public/voice-samples/*.mp3` | new — 17 committed sample clips |
| `frontend/app/lib/voiceCatalog.ts` | new — voice metadata + helpers |
| `frontend/app/components/vue-canvas/widgets/WidgetVoicePicker.vue` | new — launcher |
| `frontend/app/components/vue-canvas/VoiceGalleryModal.vue` | new — gallery modal |
| `frontend/app/components/vue-canvas/ComfyNodeWidget.vue` | new `voice_picker` branch |
| `frontend/app/components/vue-canvas/VueNodeCanvas.vue` | mount modal + open listener |
| `frontend/tests/unit/voiceCatalog.unit.spec.ts` | new — catalog unit tests |

[WidgetCombo.vue]: ../../../frontend/app/components/vue-canvas/widgets/WidgetCombo.vue
