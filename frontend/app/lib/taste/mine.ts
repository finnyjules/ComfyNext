// Observed-taste miner: extracts the user's REAL parameter choices from saved
// project version files, for three studios (Gradient, Shader, Vector Type).
//
// Pure module — no fs. Callers (the taste-mine unit spec) walk the projects
// directory and feed parsed version JSON into `mineVersion`, then `aggregate`
// turns the pooled samples into per-param stats keyed by param path.
//
// Schema drift is handled by piping every raw node config through the studio's
// own migration/normalization helper before reading:
//  - Gradient: `ensureConfigDefaults` (backfills post.*, migrates legacy
//    relief.grain -> post.grainAmount and deletes the legacy field)
//  - Shader: `migrateShaderConfig` (v1 singular `effect` -> `effects[]`) then
//    `hydrateConfig` (fills missing keys from current defaults)
//  - Vector Type: `mergeConfig` (legacy flat fill/stroke -> `appearance[]`)

import { ensureConfigDefaults } from '~/lib/gradientfx/types'
import { migrateShaderConfig } from '~/lib/shaderstudio/migrate'
import { hydrateConfig } from '~/lib/shaderstudio/types'
import { mergeConfig } from '~/lib/vectortype/config'

export type Studio = 'gradient' | 'shader' | 'vectorType'

export interface NumSample { studio: Studio; path: string; project: string; value: number }
export interface EnumSample { studio: Studio; path: string; project: string; value: string }
export interface ColorSample { studio: Studio; project: string; hex: string }

export interface MineResult {
  nums: NumSample[]
  enums: EnumSample[]
  colors: ColorSample[]
  /** Studio node instances seen in this version. */
  nodeCounts: Record<Studio, number>
}

const HEX_RE = /^#[0-9a-f]{3,8}$/i

// ── Version-file selection ──────────────────────────────────────────────────

/**
 * Pick the LATEST version file for a project so heavy users don't double-count
 * drafts: prefer `current.json` (the latest autosave), else the newest
 * `b_<ms>.json` named version. Returns null when nothing matches.
 */
export function pickLatestVersionFile(files: string[]): string | null {
  if (files.includes('current.json')) return 'current.json'
  let best: string | null = null
  let bestMs = -1
  for (const f of files) {
    const m = /^b_(\d+)\.json$/.exec(f)
    if (!m) continue
    const ms = Number(m[1])
    if (ms > bestMs) { bestMs = ms; best = f }
  }
  return best
}

// ── Generic leaf walker ─────────────────────────────────────────────────────

interface WalkSinks {
  num: (path: string, value: number) => void
  enum: (path: string, value: string) => void
}

interface WalkOpts {
  /** Return a stable label for an array element (e.g. effect id, layer kind).
   *  Default: '*' so positional indices collapse into one param path. */
  arrayLabel?: (parentPath: string, item: unknown, index: number) => string
  /** Skip a whole subtree (matched on the would-be path of the key). */
  skipPath?: (path: string) => boolean
}

/** Subtrees that are per-document noise, not parameter taste. */
const COMMON_SKIP = [
  /(^|\.)motion\.tracks\b/, // keyframe data, not knob choices
  /(^|\.)mesh\.points\b/,   // auto-seeded mesh coordinates
  /(^|\.)locks\b/,
]

function defaultSkip(path: string): boolean {
  return COMMON_SKIP.some(re => re.test(path))
}

const SKIP_KEYS = new Set(['id', 'layerId', 'seed', 'version', 'text', 'customChars'])

function walkLeaves(node: unknown, path: string, sinks: WalkSinks, opts: WalkOpts): void {
  if (node == null) return
  if (typeof node === 'number') {
    if (Number.isFinite(node)) sinks.num(path, node)
    return
  }
  if (typeof node === 'boolean') { sinks.enum(path, String(node)); return }
  if (typeof node === 'string') {
    // Hex colors are pooled separately (per-studio, hand-rolled); long strings
    // and URLs/data URIs are content, not parameters.
    if (HEX_RE.test(node)) return
    if (node.length <= 32 && !/^(https?:|data:)/.test(node)) sinks.enum(path, node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      const label = opts.arrayLabel?.(path, item, i) ?? '*'
      walkLeaves(item, `${path}[${label}]`, sinks, opts)
    })
    return
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (SKIP_KEYS.has(k)) continue
      const p = path ? `${path}.${k}` : k
      if (defaultSkip(p) || opts.skipPath?.(p)) continue
      walkLeaves(v, p, sinks, opts)
    }
  }
}

// ── Per-studio extraction ───────────────────────────────────────────────────

function collectHexes(node: unknown, out: string[]): void {
  if (typeof node === 'string') { if (HEX_RE.test(node)) out.push(node.toLowerCase()); return }
  if (Array.isArray(node)) { for (const v of node) collectHexes(v, out); return }
  if (node && typeof node === 'object') for (const v of Object.values(node)) collectHexes(v, out)
}

function mineGradient(raw: unknown, project: string, res: MineResult): void {
  // ensureConfigDefaults mutates; work on a clone of the stored blob.
  const cfg = ensureConfigDefaults(JSON.parse(JSON.stringify(raw ?? {})))
  res.nodeCounts.gradient++
  const emit = sinksFor('gradient', project, res)
  walkLeaves(cfg, '', emit, {})
  // Colors: gradient stop colors + canvas background, pooled per studio.
  for (const layer of (cfg as any).layers ?? []) {
    for (const stop of layer?.color?.stops ?? []) {
      if (typeof stop?.color === 'string' && HEX_RE.test(stop.color)) {
        res.colors.push({ studio: 'gradient', project, hex: stop.color.toLowerCase() })
      }
    }
  }
  const bg = (cfg as any).canvas?.background
  if (typeof bg === 'string' && HEX_RE.test(bg)) res.colors.push({ studio: 'gradient', project, hex: bg.toLowerCase() })
}

function mineShader(raw: unknown, project: string, res: MineResult): void {
  const cfg = hydrateConfig(migrateShaderConfig(JSON.parse(JSON.stringify(raw ?? {}))))
  res.nodeCounts.shader++
  const emit = sinksFor('shader', project, res)
  walkLeaves(cfg, '', emit, {
    // Key each effect's params by the effect id, not its stack position:
    // `effects[blinds].params.u_count` is one param across every project.
    arrayLabel: (p, item) =>
      p === 'effects' && item && typeof (item as any)?.id === 'string' && (item as any).id
        ? (item as any).id : '*',
    skipPath: p => p === 'source', // input image reference, not a parameter
  })
  // Colors: duotone ink/paper (only when the effect is actually on — the
  // defaults are always present post-hydrate) plus any color params on effects.
  const duo = (cfg as any).duotone
  if (duo?.enabled) {
    for (const k of ['ink', 'paper']) {
      const v = duo[k]
      if (typeof v === 'string' && HEX_RE.test(v)) res.colors.push({ studio: 'shader', project, hex: v.toLowerCase() })
    }
  }
  const gmap = (cfg as any).gradientMap
  if (gmap?.enabled) {
    for (const stop of gmap.stops ?? []) {
      const v = stop?.color
      if (typeof v === 'string' && HEX_RE.test(v)) res.colors.push({ studio: 'shader', project, hex: v.toLowerCase() })
    }
  }
  for (const eff of (cfg as any).effects ?? []) {
    const hexes: string[] = []
    collectHexes(eff?.params, hexes)
    for (const hex of hexes) res.colors.push({ studio: 'shader', project, hex })
  }
}

function mineVectorType(raw: unknown, project: string, res: MineResult): void {
  // The node property wraps the config: { config, canvasW, canvasH, aspectKey,
  // background }. Tolerate a bare config blob too.
  const wrapper = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const inner = 'config' in wrapper ? wrapper.config : wrapper
  const cfg = mergeConfig(inner)
  res.nodeCounts.vectorType++
  const emit = sinksFor('vectorType', project, res)
  walkLeaves(cfg, '', emit, {
    // Label appearance layers by KIND (fill/stroke/extrude) — positional index
    // is meaningless across projects, kind is the taste-relevant identity.
    arrayLabel: (p, item) =>
      p === 'appearance' && typeof (item as any)?.kind === 'string' ? (item as any).kind : '*',
  })
  // Wrapper-level canvas choices.
  for (const k of ['canvasW', 'canvasH'] as const) {
    const v = wrapper[k]
    if (typeof v === 'number' && Number.isFinite(v)) res.nums.push({ studio: 'vectorType', path: `canvas.${k}`, project, value: v })
  }
  if (typeof wrapper.aspectKey === 'string') res.enums.push({ studio: 'vectorType', path: 'canvas.aspectKey', project, value: wrapper.aspectKey })
  // Colors: layer paints (a always; b only when the paint actually uses it)
  // plus the canvas background.
  for (const layer of cfg.appearance ?? []) {
    const paint = (layer as any)?.paint
    if (!paint || typeof paint !== 'object') continue
    if (typeof paint.a === 'string' && HEX_RE.test(paint.a)) res.colors.push({ studio: 'vectorType', project, hex: paint.a.toLowerCase() })
    if (paint.type !== 'solid' && typeof paint.b === 'string' && HEX_RE.test(paint.b)) {
      res.colors.push({ studio: 'vectorType', project, hex: paint.b.toLowerCase() })
    }
  }
  const bg = wrapper.background
  if (typeof bg === 'string' && HEX_RE.test(bg)) res.colors.push({ studio: 'vectorType', project, hex: bg.toLowerCase() })
}

function sinksFor(studio: Studio, project: string, res: MineResult): WalkSinks {
  return {
    num: (path, value) => res.nums.push({ studio, path, project, value }),
    enum: (path, value) => res.enums.push({ studio, path, project, value }),
  }
}

// ── Version mining ──────────────────────────────────────────────────────────

const NODE_PROP: Record<string, { studio: Studio; key: string }> = {
  GradientStudio: { studio: 'gradient', key: 'sailor_gradientStudio' },
  ShaderStudio: { studio: 'shader', key: 'sailor_shaderStudio' },
  VectorType: { studio: 'vectorType', key: 'sailor_vectorType' },
}

/**
 * Mine one parsed version file. `workflow` is EITHER a legacy bare LiteGraph
 * workflow ({ nodes, links }) OR a ProjectDoc with `canvases` — both handled.
 */
export function mineVersion(version: any, project: string, into?: MineResult): MineResult {
  const res: MineResult = into ?? {
    nums: [], enums: [], colors: [],
    nodeCounts: { gradient: 0, shader: 0, vectorType: 0 },
  }
  const wf = version?.workflow ?? {}
  const canvases: any[] = Array.isArray(wf?.canvases) ? wf.canvases : [{ workflow: wf }]
  for (const canvas of canvases) {
    const nodes: any[] = canvas?.workflow?.nodes ?? []
    for (const node of nodes) {
      const spec = NODE_PROP[node?.type]
      if (!spec) continue
      const cfg = node?.properties?.[spec.key]
      if (cfg == null) continue
      try {
        if (spec.studio === 'gradient') mineGradient(cfg, project, res)
        else if (spec.studio === 'shader') mineShader(cfg, project, res)
        else mineVectorType(cfg, project, res)
      } catch {
        // A single corrupt node config must not sink the whole mine run.
      }
    }
  }
  return res
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export interface ParamStats {
  n: number
  /** Distinct projects contributing at least one sample. */
  projects: number
  min: number
  p25: number
  median: number
  p75: number
  max: number
}

export interface StudioObserved {
  nodes: number
  projects: number
  params: Record<string, ParamStats>
  enums: Record<string, Record<string, number>>
  colors: Record<string, number>
}

export interface ObservedTaste {
  generatedAt: string
  projectsScanned: number
  projectsMined: number
  studios: Record<Studio, StudioObserved>
  /** Top params by n, with per-project values for attribution. */
  topParams: Array<{ studio: Studio; path: string; n: number; perProject: Record<string, number[]> }>
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const v = sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
  return round(v)
}

function round(v: number): number {
  return Math.abs(v) >= 1000 ? Math.round(v) : Math.round(v * 10000) / 10000
}

export function aggregate(
  res: MineResult,
  meta: { projectsScanned: number; projectsMined: number },
  topN = 30,
): ObservedTaste {
  const studios: Record<Studio, StudioObserved> = {
    gradient: emptyStudio(), shader: emptyStudio(), vectorType: emptyStudio(),
  }
  studios.gradient.nodes = res.nodeCounts.gradient
  studios.shader.nodes = res.nodeCounts.shader
  studios.vectorType.nodes = res.nodeCounts.vectorType

  // Group numeric samples per (studio, path).
  const groups = new Map<string, NumSample[]>()
  const studioProjects: Record<Studio, Set<string>> = {
    gradient: new Set(), shader: new Set(), vectorType: new Set(),
  }
  for (const s of res.nums) {
    const key = `${s.studio}|${s.path}`
    let arr = groups.get(key)
    if (!arr) groups.set(key, arr = [])
    arr.push(s)
    studioProjects[s.studio].add(s.project)
  }
  for (const s of res.enums) studioProjects[s.studio].add(s.project)
  for (const st of ['gradient', 'shader', 'vectorType'] as const) {
    studios[st].projects = studioProjects[st].size
  }

  const ranked: Array<{ studio: Studio; path: string; n: number; samples: NumSample[] }> = []
  for (const [key, samples] of groups) {
    const sep = key.indexOf('|')
    const studio = key.slice(0, sep) as Studio
    const path = key.slice(sep + 1)
    const values = samples.map(s => s.value).sort((a, b) => a - b)
    studios[studio].params[path] = {
      n: values.length,
      projects: new Set(samples.map(s => s.project)).size,
      min: round(values[0]!),
      p25: quantile(values, 0.25),
      median: quantile(values, 0.5),
      p75: quantile(values, 0.75),
      max: round(values[values.length - 1]!),
    }
    ranked.push({ studio, path, n: values.length, samples })
  }

  for (const s of res.enums) {
    const byPath = studios[s.studio].enums
    const counts = (byPath[s.path] ??= {})
    counts[s.value] = (counts[s.value] ?? 0) + 1
  }
  for (const c of res.colors) {
    const pool = studios[c.studio].colors
    pool[c.hex] = (pool[c.hex] ?? 0) + 1
  }
  // Sort color pools by frequency so the JSON reads top-down.
  for (const st of Object.values(studios)) {
    st.colors = Object.fromEntries(Object.entries(st.colors).sort((a, b) => b[1] - a[1]))
  }

  ranked.sort((a, b) => b.n - a.n || a.path.localeCompare(b.path))
  const topParams = ranked.slice(0, topN).map(({ studio, path, n, samples }) => {
    const perProject: Record<string, number[]> = {}
    for (const s of samples) (perProject[s.project] ??= []).push(round(s.value))
    return { studio, path, n, perProject }
  })

  return {
    generatedAt: new Date().toISOString(),
    projectsScanned: meta.projectsScanned,
    projectsMined: meta.projectsMined,
    studios,
    topParams,
  }
}

function emptyStudio(): StudioObserved {
  return { nodes: 0, projects: 0, params: {}, enums: {}, colors: {} }
}
