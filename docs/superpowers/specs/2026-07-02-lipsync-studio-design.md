# Lip-Sync Studio — Design Spec

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation plan
**Related:** [[project_shot_director]], [[project_character_library]], [[project_train_a_voice]], [[project_voice_preview_gallery]], [[project_in_product_agent]]

## Goal

A dedicated **Lip-Sync Studio** — a guardrailed studio surface that makes a character (or any image/video) speak a specific voice clip, producing a lip-synced talking video. It composes existing pieces (two lip-sync models + the TTS/voice-clone stack + the character library) into one humane flow: *"my character says X in my voice."*

## Background / what already exists (this build is composition, not integration)

- **Lip-sync models, already wired:**
  - `veed/fabric-1.0` — image + audio → talking head. Builder `_b_fabric_1_0` in `comfy_api_nodes/video_models.py` (`{image, audio, resolution}`; ignores prompt/aspect/duration — framing from the image, length from the audio). **Validated live 2026-07-02** (Vera portrait + MiniMax TTS → clear articulation, identity preserved, voice muxed into output; `output/video/lipsync-fabric-test.mp4`).
  - `sync/lipsync-2-pro` — video (or image) + audio → resynced lips, "best-in-class". Wired as `LipsyncRemoteNode` (`{video, audio, sync_mode}`; `sync_mode ∈ loop/bounce/cut_off/silence/remap` for length mismatch).
- **Voice / speech, already wired:** ElevenLabs TTS + instant voice clone (`nodes_elevenlabs.py`), MiniMax speech; a **voice library** (`/api/voices-local`, cloned voices with preview clips, `VoiceGalleryModal`, `WidgetVoicePicker`, `voiceCatalog.ts`), and the voice-clone flow (`/api/voice-clone/*`).
- **Character library:** `useCharacters` (cover/reference images per character + variant), `CharacterLibraryPanel`.
- **Studio pattern to mirror:** Shot Director — `ARTIFACT_NODE_COMPONENTS` registration in `useVueNodes.ts`, a Node card + Surface modal, state at `node.data.properties.comfynext_*`, a pure `lib/shotdirector/` compile core + `useShotDirector` composable, and a Generate that compiles → patches a target node → `runFiltered` (studio bakes nothing; remembers a target node id).

**Key finding from this session:** Seedance *native* dialogue lip-syncs to its own generated voice, but supplying your own audio to Seedance does NOT lip-sync to it. Hence a dedicated lip-sync path is the right tool for "drive a character with a specific voice clip."

## Decisions (locked from brainstorming)

- **Face source (v1):** character-from-library, uploaded image, AND existing video (relip).
- **Voice source (v1):** type-to-speak (voice picked from the library incl. cloned voices → TTS), upload audio, reuse an existing clip.
- **Form factor:** a dedicated Lip-Sync Studio surface (node card + rich modal), like Shot Director.
- **Engine auto-selection:** image/character → Fabric; video → sync. Manual override available.

## Architecture

One studio → one backend node fronting both engines, exactly like `GenerateVideoNode` fronts the video fleet.

### Backend: `LipSyncNode` (new, in `comfy_api_nodes/nodes_replicate.py`)

A use-case node with inputs: a face (`image` optional + `video_url` string), an `audio` clip, an `engine` combo (`auto`/`fabric`/`sync`), `resolution`, and `sync_mode` (advanced, sync only). `execute` resolves the engine (auto → fabric if only an image is present, sync if a video is present), shapes the input per engine, and dispatches to the existing Replicate slug via `_run_prediction`:
- Fabric: `{image, audio, resolution}` → `veed/fabric-1.0`.
- sync: `{video, audio, sync_mode}` → `sync/lipsync-2-pro`.
It reuses the existing `_b_fabric_1_0` builder and the sync input shape from `LipsyncRemoteNode`; the audio dict is encoded to a data URL the same way those nodes do (`_audio_dict_to_wav_data_url`). The raw `LipsyncRemoteNode` and the Fabric-via-`GenerateVideoNode` path stay for back-compat; the studio targets the new single node.

Rationale for a new node over reusing two: the studio pattern dispatches to ONE remembered target node type (Shot Director → FilmShotNode). A single `LipSyncNode` keeps that contract; the marginal Python is small because the builders already exist.

### Backend: `/api/lipsync/speech.post.ts` (new Nitro route)

"Type to speak" needs text → audio at Generate time. Mirror the existing server-route pattern (`cloud-train/caption.post.ts`, `cloud-train/aesthetic.post.ts`): POST `{ text, voiceId }` → generate speech, save the audio into the ComfyUI input dir, return a `/view?filename=…&type=input` URL. That URL rides the exact ref-resolution rails FilmShotNode/LipSyncNode already use (resolved to a data URL at execute). Must be allowlisted in `server/middleware/comfyui-proxy.ts` (`NITRO_API_PATHS`).

**Provider dispatch:** the route resolves the voice's provider from its record, not a fixed one — a cloned voice from `/api/voices-local` carries its provider/model in its sidecar (the voice-clone flow is MiniMax), so cloned voices generate via MiniMax with their `voice_id`; a built-in catalog voice (`voiceCatalog.ts`) uses that catalog entry's provider. This keeps "your cloned voice" faithful. If a voice's provider can't be resolved, fall back to the app's default speech provider with a generic voice and surface a note.

### Frontend

- **`LipSyncNode.vue`** (node card) + **`LipSyncSurface.vue`** (the studio modal) + registration in `ARTIFACT_NODE_COMPONENTS` (`useVueNodes.ts`) and the `VueNodeCanvas.vue` component map + node-type synthesis (wildcard output + no inputs, like ShotDirector). State at `node.data.properties.comfynext_lipSync`.
- **`lib/lipsync/`** — pure core: types (`LipSyncSheet`), `hydrate`, `compile` (sheet → node-input patch + validation issues), `engine` resolution (face kind → engine), `price` (~$1/30s estimate from audio length). Unit-tested like `lib/shotdirector/`.
- **`useLipSync`** composable — reactive sheet + result + Generate/reroll, mirroring `useShotDirector`.
- **Face panel** (3 tabs): Character (pick from `useCharacters` → cover image URL), Image (upload → `/view` URL via the existing ref-upload path), Video (upload/URL).
- **Voice panel** (3 tabs): Type to speak (textarea + voice picker reusing `VoiceGalleryModal`/`voiceCatalog` incl. cloned voices → calls `/api/lipsync/speech`), Upload audio, Existing clip (URL).
- **Engine + format row:** auto/override engine, resolution, sync_mode (shown only for the sync engine).
- **Footer:** cost estimate + Generate + New take (reuses the Shot Director footer/dispatch idiom).

## Data flow (Generate)

1. Resolve the voice: if "type to speak," POST text+voiceId to `/api/lipsync/speech` → audio `/view` URL; else use the uploaded/existing audio URL.
2. Resolve the face: character → cover image URL; uploaded image/video → `/view` URL.
3. Resolve the engine: `auto` → fabric if the face is an image/character, sync if a video.
4. Compile the `LipSyncNode` widget/model_options patch; find-or-spawn the target `LipSyncNode`; patch it; `runFiltered`.
5. Backend `execute` resolves local refs (image/video/audio `/view` → data URLs), shapes per engine, dispatches, returns the video.

## Error handling / guardrails (as validation issues, Shot Director style)

- No face selected → blocking issue; Generate disabled.
- No voice (empty text with no audio) → blocking issue.
- Video face + Fabric engine → auto-switch to sync with a warning note (Fabric is image-only).
- Empty/failed TTS → surfaced error; no dispatch.
- Cost estimate shown on the button; failed remote runs are free (same as other Replicate paths).

## Testing

- **Frontend units** (`frontend/tests/unit/lipsync-*.unit.spec.ts`): compile core (sheet → node input per engine), engine resolution (image→fabric, video→sync, override), price estimate, validation issues.
- **Python units** (`tests-unit/comfy_api_test/`): `LipSyncNode` engine resolution + per-engine input shape (fabric `{image,audio,resolution}` vs sync `{video,audio,sync_mode}`); audio-dict encoding path.
- **Live smoke (paid, ~$2):** one Fabric run (character image + type-to-speak voice) and one sync run (uploaded video + audio) end-to-end through the studio; verify lip-sync + identity, then look sign-off.

## Out of scope (v1)

- Multi-speaker / dialogue turns in one clip.
- Emotion/performance controls beyond what the engines expose.
- Background/scene compositing of the talking head (it renders framed by the source image).
- Real-time preview; a "save as character talking clip" library.
- Agent/vibe control of the studio (future, per [[project_in_product_agent]]).

## Rollout notes

- New backend node + route require a ComfyUI restart (Python) and the proxy allowlist entry.
- Fabric output is square-ish, framed by the source image, length = audio; sync preserves the source video framing. Surface copy should set that expectation.
