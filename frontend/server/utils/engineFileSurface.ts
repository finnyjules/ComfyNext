/**
 * Stage 6 Task 7b — the engine's file-READ surface, as a checked-in map.
 *
 * Task 7 shipped a validator that only inspected object_info UPLOAD-FLAGGED
 * inputs plus a hardcoded `LoadImageOutput.image`. The engine has many more
 * nodes whose execute reads a file from a shared `input/`/`output/`/`temp/`
 * directory via `folder_paths.get_annotated_filepath` (a bare join with NO
 * containment) — through UNFLAGGED plain-string inputs, dict-valued inputs
 * (Load3D's `image`), and JSON-blob inputs (Compositor's `motion_params`, the
 * type nodes' `params`, Timeline's `edit_state`). A hand-crafted graph can
 * carry another tenant's filename through any of these and launder a
 * cross-tenant read: several decode the file into an IMAGE/VIDEO the attacker
 * then saves to their own `u_<hash>/` folder and views.
 *
 * GRAPH_FILE_READERS is the authoritative map the graph validator walks to
 * decide which inputs carry a filename it must vet for ownership before a
 * graph runs. It is keyed by class_type (the engine `node_id`). The
 * coverage guard in engine-file-surface.unit.spec.ts greps the engine tree and
 * fails on drift, so a newly-added file-reading node fails the suite instead of
 * silently bypassing the check.
 *
 * LOCAL BYTE-IDENTICAL: nothing here runs in local mode — it is consulted only
 * from the hosted meterGraphSubmit / handleMeteredPrompt path.
 */

/** How a file input carries its filename(s). */
export type FileRefSemantics = 'input' | 'output' | 'either'

/**
 * `either` = the value is routed by a trailing ` [output]`/` [input]`/` [temp]`
 * annotation (folder_paths.get_annotated_filepath). `input`/`output` = the
 * engine always reads from that tree regardless of any annotation on the value.
 */
export type FileReaderSpec =
  | { input: string, shape: 'string', semantics: FileRefSemantics }
  | { input: string, shape: 'dict', keys: string[], semantics: FileRefSemantics }
  | { input: string, shape: 'json', jsonPath: 'rendered' | 'timeline-clips', semantics: FileRefSemantics }

/**
 * class_type → the file-carrying inputs the engine reads on execute. Evidence
 * lives in the Task 7b report (per-node file:line). Semantics are `either`
 * wherever the read routes through get_annotated_filepath (annotation-honouring);
 * `input`/`output` where the engine hard-codes the tree.
 */
export const GRAPH_FILE_READERS: Record<string, FileReaderSpec[]> = {
  // nodes.py
  LoadImage: [{ input: 'image', shape: 'string', semantics: 'either' }],
  LoadImageMask: [{ input: 'image', shape: 'string', semantics: 'either' }],
  // LoadImageOutput reads from the OUTPUT tree by definition (its remote combo
  // lists output/, and load_image reads whatever filename it is handed). This
  // spec subsumes the old hardcoded pair.
  LoadImageOutput: [{ input: 'image', shape: 'string', semantics: 'output' }],
  LoadLatent: [{ input: 'latent', shape: 'string', semantics: 'either' }],
  // comfy_extras/nodes_load_3d.py — Load3D.image is a dict of annotated names.
  Load3D: [
    { input: 'image', shape: 'dict', keys: ['image', 'mask', 'normal', 'recording'], semantics: 'either' },
    { input: 'model_file', shape: 'string', semantics: 'either' },
  ],
  // comfy_extras/nodes_scene3d.py
  Scene3DStudio: [
    { input: 'beauty_image', shape: 'string', semantics: 'either' },
    { input: 'depth_image', shape: 'string', semantics: 'either' },
    { input: 'normal_image', shape: 'string', semantics: 'either' },
  ],
  // comfy_extras/nodes_pose_mannequin.py
  PoseMannequin: [
    { input: 'result_image', shape: 'string', semantics: 'either' },
    { input: 'pose_cond_image', shape: 'string', semantics: 'either' },
    { input: 'mannequin_image', shape: 'string', semantics: 'either' },
  ],
  // comfy_extras/nodes_compositor.py — motion_params JSON carries the baked
  // frame filenames under `rendered` (a list).
  Compositor: [{ input: 'motion_params', shape: 'json', jsonPath: 'rendered', semantics: 'either' }],
  // comfy_extras type nodes — params JSON carries the uploaded render filename(s)
  // under `rendered` (a string for RenderType/TextMask/TextOnPath, a list for
  // KineticType — extractFileRefs handles both).
  RenderType: [{ input: 'params', shape: 'json', jsonPath: 'rendered', semantics: 'either' }],
  KineticType: [{ input: 'params', shape: 'json', jsonPath: 'rendered', semantics: 'either' }],
  TextMask: [{ input: 'params', shape: 'json', jsonPath: 'rendered', semantics: 'either' }],
  TextOnPath: [{ input: 'params', shape: 'json', jsonPath: 'rendered', semantics: 'either' }],
  // comfy_extras/nodes_image.py — the `Image` node (SaveImage subclass) loads a
  // file from its `image` combo when no upstream image is wired.
  Image: [{ input: 'image', shape: 'string', semantics: 'either' }],
  // comfy_extras/nodes_video.py
  LoadVideo: [{ input: 'file', shape: 'string', semantics: 'either' }],
  Video: [{ input: 'file', shape: 'string', semantics: 'either' }],
  // comfy_extras/nodes_video_pro.py
  LUT: [{ input: 'lut_file', shape: 'string', semantics: 'either' }],
  AudioWaveform: [{ input: 'audio_file', shape: 'string', semantics: 'either' }],
  // comfy_extras/nodes_video_effects.py
  LoadVideoFrames: [{ input: 'file', shape: 'string', semantics: 'either' }],
  SaveVideoFrames: [{ input: 'audio_file', shape: 'string', semantics: 'either' }],
  // comfy_extras/nodes_audio.py
  Audio: [{ input: 'audio', shape: 'string', semantics: 'either' }],
  LoadAudio: [{ input: 'audio', shape: 'string', semantics: 'either' }],
  RecordAudio: [{ input: 'audio', shape: 'string', semantics: 'either' }],
  // comfy_extras/nodes_painter.py
  Painter: [{ input: 'mask', shape: 'string', semantics: 'either' }],
  // comfy_extras/nodes_webcam.py
  WebcamCapture: [{ input: 'image', shape: 'string', semantics: 'either' }],
  // comfy_extras/nodes_timeline.py — the graph node reads image-clip files out
  // of the edit_state JSON via os.path.join(input_dir, path) with NO annotation
  // routing, so semantics is `input` and the literal value is vetted (an
  // absolute path or a foreign subfolder is refused).
  Timeline: [{ input: 'edit_state', shape: 'json', jsonPath: 'timeline-clips', semantics: 'input' }],
}

/**
 * Extract the filename(s) a graph node would read from one file input's value.
 *
 * Returns `[]` when the input is absent/empty (no file referenced — leaves
 * zero-file and partial graphs alone), a list of filename strings when it can
 * read them, or `null` when the value is PRESENT but not in the shape we can
 * vet (a wired link, a number, a non-object dict, unparseable JSON, an
 * unexpected `rendered` shape). A `null` means the caller must FAIL CLOSED and
 * refuse — we cannot vet what we cannot read.
 */
export function extractFileRefs(spec: FileReaderSpec, value: unknown): string[] | null {
  if (value === undefined || value === null) return []

  if (spec.shape === 'string') {
    if (typeof value !== 'string') return null
    return value === '' ? [] : [value]
  }

  if (spec.shape === 'dict') {
    if (typeof value !== 'object' || Array.isArray(value)) return null
    const out: string[] = []
    for (const k of spec.keys) {
      const v = (value as Record<string, unknown>)[k]
      if (v === undefined || v === null || v === '') continue
      if (typeof v !== 'string') return null
      out.push(v)
    }
    return out
  }

  // json
  if (typeof value !== 'string') return null
  if (value === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  return spec.jsonPath === 'rendered' ? collectRendered(parsed) : collectTimelineClips(parsed)
}

/** The `rendered` field of a params/motion blob: a string or a list of strings. */
function collectRendered(parsed: unknown): string[] | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const r = (parsed as Record<string, unknown>).rendered
  if (r === undefined || r === null || r === '') return []
  if (typeof r === 'string') return [r]
  if (Array.isArray(r)) {
    const out: string[] = []
    for (const el of r) {
      if (el === undefined || el === null || el === '') continue
      // The engine does str(el) and reads it — a non-string element is an
      // anomaly we cannot vet, so refuse rather than guess.
      if (typeof el !== 'string') return null
      out.push(el)
    }
    return out
  }
  return null
}

/** Timeline edit_state: image-clip file paths under tracks[].clips[].path / .asset_path. */
function collectTimelineClips(parsed: unknown): string[] | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const tracks = (parsed as Record<string, unknown>).tracks
  if (tracks === undefined || tracks === null) return []
  if (!Array.isArray(tracks)) return null
  const out: string[] = []
  for (const t of tracks) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue
    const clips = (t as Record<string, unknown>).clips
    if (clips === undefined || clips === null) continue
    if (!Array.isArray(clips)) return null
    for (const c of clips) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) continue
      for (const key of ['path', 'asset_path']) {
        const v = (c as Record<string, unknown>)[key]
        if (v === undefined || v === null || v === '') continue
        if (typeof v !== 'string') return null
        out.push(v)
      }
    }
  }
  return out
}
