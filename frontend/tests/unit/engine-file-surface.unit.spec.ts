/**
 * Stage 6 Task 7b — engine file-surface coverage guards.
 *
 * These read the Python engine tree at TEST time (never at runtime) and FAIL
 * ON DRIFT, so a newly-added file-reading or file-writing node fails the suite
 * instead of silently bypassing the per-user ownership checks:
 *
 *  (A) every `folder_paths.get_annotated_filepath(` read site is accounted for
 *      — its file's node(s) are in GRAPH_FILE_READERS, or the file's reads are
 *      documented non-graph-node reads (an HTTP-route helper). A read added to
 *      a covered file bumps the per-file count and trips the guard.
 *  (B) every `folder_paths.get_output_directory(` write site's node is in
 *      OUTPUT_CLASS_TYPES (so its output is subfoldered under u_<hash>/) or on
 *      the explicit write-exempt list. Deliverable savers that delegate to a UI
 *      helper (no get_output_directory in-file) are enumerated separately and
 *      asserted present in OUTPUT_CLASS_TYPES.
 *
 * The grep recurses comfy_extras/ subdirs + custom_nodes/ and matches the
 * literal folder_paths primitives the engine uses.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GRAPH_FILE_READERS } from '../../server/utils/engineFileSurface'
import { OUTPUT_CLASS_TYPES } from '../../server/utils/priceBook'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const SKIP_DIRS = new Set(['__pycache__', '.venv', 'venv', 'node_modules', '.git'])

/** Every .py file under the engine roots the brief greps. */
function enginePyFiles(): string[] {
  const out: string[] = []
  const walk = (abs: string) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(join(abs, ent.name))
      }
      else if (ent.name.endsWith('.py')) {
        out.push(relative(REPO, join(abs, ent.name)).replace(/\\/g, '/'))
      }
    }
  }
  walk(join(REPO, 'comfy_extras'))
  walk(join(REPO, 'custom_nodes'))
  out.push('nodes.py')
  return out
}

function countMatches(relPath: string, re: RegExp): number {
  const src = readFileSync(join(REPO, relPath), 'utf8')
  return (src.match(re) ?? []).length
}

/** Per-file live count for a folder_paths primitive across the engine tree. */
function liveCounts(re: RegExp): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of enginePyFiles()) {
    const n = countMatches(f, re)
    if (n > 0) out[f] = n
  }
  return out
}

// ---------------------------------------------------------------------------
// (A) READ surface — folder_paths.get_annotated_filepath(
// ---------------------------------------------------------------------------

const ANNOTATED_RE = /folder_paths\.get_annotated_filepath\(/g

/**
 * Every file with an annotated-read site, its count, and the class_type(s) that
 * read through it. `note` documents read sites that are NOT graph-node reads
 * (an HTTP-route helper) so their absence from GRAPH_FILE_READERS is deliberate.
 */
const ANNOTATED_READ_FILES: Record<string, { count: number, nodes: string[], note?: string }> = {
  'nodes.py': { count: 6, nodes: ['LoadLatent', 'LoadImage', 'LoadImageMask'] },
  'comfy_extras/nodes_compositor.py': { count: 1, nodes: ['Compositor'] },
  'comfy_extras/nodes_kinetic_type.py': { count: 1, nodes: ['KineticType'] },
  'comfy_extras/nodes_pose_mannequin.py': { count: 1, nodes: ['PoseMannequin'] },
  'comfy_extras/nodes_scene3d.py': { count: 1, nodes: ['Scene3DStudio'] },
  'comfy_extras/nodes_text_mask.py': { count: 1, nodes: ['TextMask'] },
  'comfy_extras/nodes_text_on_path.py': { count: 1, nodes: ['TextOnPath'] },
  'comfy_extras/nodes_type.py': { count: 1, nodes: ['RenderType'] },
  'comfy_extras/nodes_webcam.py': { count: 1, nodes: ['WebcamCapture'] },
  'comfy_extras/nodes_image.py': { count: 2, nodes: ['Image'] },
  'comfy_extras/nodes_painter.py': { count: 2, nodes: ['Painter'] },
  'comfy_extras/nodes_video_pro.py': { count: 2, nodes: ['LUT', 'AudioWaveform'] },
  'comfy_extras/nodes_video_effects.py': { count: 3, nodes: ['LoadVideoFrames', 'SaveVideoFrames'] },
  'comfy_extras/nodes_video.py': { count: 4, nodes: ['LoadVideo', 'Video'] },
  'comfy_extras/nodes_audio.py': { count: 5, nodes: ['Audio', 'LoadAudio', 'RecordAudio'] },
  'comfy_extras/nodes_load_3d.py': { count: 5, nodes: ['Load3D'] },
  'comfy_extras/nodes_timeline.py': {
    count: 1, nodes: [],
    note: 'encode_spacetype_video is an HTTP-route helper (POST /sailor/spacetype_encode), not a graph node. '
      + 'The Timeline graph node reads image clips via os.path.join(input_dir, ...) — covered as an input-join reader below.',
  },
}

/**
 * Graph readers whose read site is NOT a get_annotated_filepath call in their
 * own file, so they never appear in ANNOTATED_READ_FILES: LoadImageOutput
 * inherits LoadImage.load_image, and Timeline reads image clips via
 * os.path.join(get_input_directory(), path) (nodes_timeline.py).
 */
const NON_ANNOTATED_READERS = ['LoadImageOutput', 'Timeline']

describe('coverage guard (A) — every engine file-READ site is accounted for', () => {
  it('the live get_annotated_filepath per-file counts match the checked-in table (drift → fail)', () => {
    expect(liveCounts(ANNOTATED_RE)).toEqual(
      Object.fromEntries(Object.entries(ANNOTATED_READ_FILES).map(([f, v]) => [f, v.count])),
    )
  })

  it('every node named in a read-file entry is in GRAPH_FILE_READERS', () => {
    for (const [file, { nodes }] of Object.entries(ANNOTATED_READ_FILES)) {
      for (const n of nodes) {
        expect(GRAPH_FILE_READERS[n], `${n} (from ${file}) must be in GRAPH_FILE_READERS`).toBeDefined()
      }
    }
  })

  it('every GRAPH_FILE_READERS class is backed by a real read site (no orphan map entry)', () => {
    const backed = new Set<string>(NON_ANNOTATED_READERS)
    for (const { nodes } of Object.values(ANNOTATED_READ_FILES)) for (const n of nodes) backed.add(n)
    for (const ct of Object.keys(GRAPH_FILE_READERS)) {
      expect(backed.has(ct), `${ct} is in GRAPH_FILE_READERS but has no documented read site`).toBe(true)
    }
  })

  it('a read-file entry with no graph-node nodes carries a note explaining why', () => {
    for (const [file, v] of Object.entries(ANNOTATED_READ_FILES)) {
      if (v.nodes.length === 0) expect(v.note, `${file} has no reader nodes and must document why`).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// (B) WRITE surface — folder_paths.get_output_directory(
// ---------------------------------------------------------------------------

const OUTPUT_DIR_RE = /folder_paths\.get_output_directory\(/g

/**
 * Every file with a get_output_directory site, its count, and the class_type(s)
 * that write there. Each writer node must be in OUTPUT_CLASS_TYPES (so its
 * output is subfoldered) or in WRITE_EXEMPT. Files whose hits are HTTP routes /
 * shared helpers list no writer nodes and carry a note.
 */
const OUTPUT_DIR_FILES: Record<string, { count: number, writers: string[], note?: string }> = {
  'nodes.py': { count: 2, writers: ['SaveLatent', 'SaveImage'] },
  'comfy_extras/nodes_video.py': { count: 3, writers: ['SaveWEBM', 'SaveVideo', 'Video'] },
  'comfy_extras/nodes_video_effects.py': { count: 1, writers: ['SaveVideoFrames'] },
  'comfy_extras/nodes_image.py': { count: 1, writers: ['Image'] },
  'comfy_extras/nodes_load_3d.py': { count: 1, writers: ['Preview3D'] },
  'comfy_extras/nodes_hunyuan3d.py': { count: 1, writers: ['SaveGLB'] },
  'comfy_extras/nodes_lora_extract.py': { count: 1, writers: ['LoraSave'] },
  'comfy_extras/nodes_train.py': { count: 1, writers: ['SaveLoRA'] },
  'comfy_extras/nodes_images.py': { count: 1, writers: ['SaveSVGNode'] },
  'comfy_extras/nodes_model_merging.py': { count: 4, writers: ['CheckpointSave', 'CLIPSave', 'VAESave', 'ModelSave'] },
  'comfy_extras/nodes_dataset.py': {
    count: 4,
    writers: ['SaveImageDataSetToFolder', 'SaveImageTextDataSetToFolder', 'SaveTrainingDataset', 'LoadTrainingDataset'],
  },
  'comfy_extras/nodes_timeline.py': {
    count: 4, writers: [],
    note: 'all four are aiohttp route handlers (POST /sailor/render_timeline*, DELETE /sailor/output_file) — '
      + 'not graph nodes; per-tenant gating for those routes lives in engineGate.ts.',
  },
  'comfy_extras/_live_preview.py': {
    count: 1, writers: [],
    note: 'save_generation_output is a shared preview helper writing a fixed "generation" prefix (no graph filename_prefix input) — '
      + 'per-user subfoldering of helper output is a follow-up.',
  },
}

/**
 * Writer nodes whose output is NOT subfoldered by the filename_prefix injection
 * (so they are deliberately kept OUT of OUTPUT_CLASS_TYPES) — plus one reader
 * that lives in an output-dir file. Each carries the reason it is exempt.
 */
const WRITE_EXEMPT: Record<string, string> = {
  Preview3D: 'writes a random-uuid filename directly to the output root (no filename_prefix widget); cannot clobber another tenant. Per-user subfoldering would need a save-path rewrite — follow-up.',
  SaveLoRA: 'writes via a `prefix` input (default loras/ComfyUI_trained_lora), not `filename_prefix`; injectOutputSubfolder rewrites filename_prefix only — prefix-field-aware injection is a follow-up.',
  SaveImageDataSetToFolder: 'writes into output/<folder_name>/ via a `folder_name` input, not filename_prefix — folder-level per-user containment is a follow-up.',
  SaveImageTextDataSetToFolder: 'writes into output/<folder_name>/ via a `folder_name` input, not filename_prefix — folder-level per-user containment is a follow-up.',
  SaveTrainingDataset: 'writes shards into output/<folder_name>/ via a `folder_name` input, not filename_prefix — folder-level per-user containment is a follow-up.',
  LoadTrainingDataset: 'READER, not a writer: reads shards from output/<folder_name>/ (a folder, not a per-file annotated ref). Folder-level ownership is not modeled by the graph validator — follow-up concern.',
}

/**
 * Deliverable savers that DELEGATE their write to a UI helper (UI.ImageSaveHelper
 * / UI.AudioSaveHelper) and so carry no get_output_directory in their own file —
 * invisible to the grep above. Enumerated by hand and asserted present in
 * OUTPUT_CLASS_TYPES so they are still subfoldered.
 */
const HELPER_WRITER_NODES = ['SaveAnimatedWEBP', 'SaveAnimatedPNG', 'SaveAudio', 'SaveAudioMP3', 'SaveAudioOpus', 'Audio']

describe('coverage guard (B) — every engine file-WRITE site is subfoldered or exempt', () => {
  it('the live get_output_directory per-file counts match the checked-in table (drift → fail)', () => {
    expect(liveCounts(OUTPUT_DIR_RE)).toEqual(
      Object.fromEntries(Object.entries(OUTPUT_DIR_FILES).map(([f, v]) => [f, v.count])),
    )
  })

  it('every writer node is in OUTPUT_CLASS_TYPES or on the write-exempt list', () => {
    for (const [file, { writers }] of Object.entries(OUTPUT_DIR_FILES)) {
      for (const w of writers) {
        const known = OUTPUT_CLASS_TYPES.has(w) || w in WRITE_EXEMPT
        expect(known, `${w} (from ${file}) must be in OUTPUT_CLASS_TYPES or WRITE_EXEMPT`).toBe(true)
      }
    }
  })

  it('a write-file entry with no writer nodes carries a note explaining why', () => {
    for (const [file, v] of Object.entries(OUTPUT_DIR_FILES)) {
      if (v.writers.length === 0) expect(v.note, `${file} has no writer nodes and must document why`).toBeTruthy()
    }
  })

  it('helper-delegated deliverable savers are all in OUTPUT_CLASS_TYPES', () => {
    for (const n of HELPER_WRITER_NODES) {
      expect(OUTPUT_CLASS_TYPES.has(n), `${n} delegates its write to a UI helper and must be subfoldered`).toBe(true)
    }
  })

  it('every write-exempt entry documents a reason', () => {
    for (const [n, reason] of Object.entries(WRITE_EXEMPT)) {
      expect(reason.length, `${n} exemption needs a reason`).toBeGreaterThan(10)
    }
  })
})
