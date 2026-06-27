import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'

/**
 * Slit Scan — time-displacement typography.
 *
 * The BASE is a looping horizontal squish-wipe of the word (one copy compresses toward the left edge
 * to zero width while a duplicate expands from the right) — a continuous, predictable cycle that is a
 * pure function of normalized time τ. A displacement MAP (linear gradient + optional soft bumps) gives
 * each pixel a TIME delay: we evaluate the base at `τ = time·speed − luminance·delaySpread`. Because
 * different bands sit at different points on the animation timeline, the text smears/stretches like
 * elastic. No frame buffer needed — the base is analytic, so τ can be any value. Seamless: the base
 * depends only on `fract(τ)` and τ advances by an integer (speed) over the loop, with a constant
 * per-pixel delay offset.
 *
 * Multiple text lines MELT into one another: the squish-wipe's shrinking copy shows word `floor(τ)`
 * and the growing copy shows word `floor(τ)+1` (mod line-count), so each wipe dissolves one line into
 * the next — one word at a time, no overlap. τ differs per band, so bands melt at different moments
 * (the signature slit-scan smear). Seamless because τ advances by a multiple of the line count/loop.
 */
const controls: ControlSpec[] = [
  // TYPE.
  { key: 'text', label: 'Text', kind: 'textList', default: 'Slitscan', group: 'Type' },
  { key: 'textCase', label: 'Case', kind: 'select', options: ['upper', 'asis'], default: 'asis', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Archivo Black', group: 'Type' },
  { key: 'typeYScale', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 200, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // WARP — the displacement map / time delay. Gradient picks the axis: vertical (→ horizontal slits),
  // horizontal (→ vertical slits), or crosshatch (BOTH, each axis with its own controls below).
  { key: 'ssMapDir', label: 'Gradient', kind: 'select', options: ['vertical', 'horizontal', 'crosshatch'], default: 'vertical', group: 'Warp' },
  // Primary axis (the single axis in vertical/horizontal; the horizontal slits in crosshatch).
  { key: 'ssDelay', label: 'Delay spread', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1.5, group: 'Warp' },
  { key: 'ssBands', label: 'Bands', kind: 'slider', min: 0, max: 40, step: 1, default: 10, group: 'Warp' },
  { key: 'ssBandSpeed', label: 'Band speed', kind: 'slider', min: 0, max: 6, step: 1, default: 2, group: 'Warp' },
  { key: 'ssSpeedMode', label: 'Band pattern', kind: 'select', options: ['random', 'progressive'], default: 'random', group: 'Warp' },
  { key: 'ssEase', label: 'Speed ease', kind: 'slider', min: 0, max: 1, step: 0.05, default: 1, group: 'Warp' },
  // Cross axis — only used in crosshatch (the vertical slits). Hidden otherwise.
  { key: 'ssDelay2', label: 'Cross delay spread', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1.5, group: 'Warp', showIf: { key: 'ssMapDir', equals: 'crosshatch' } },
  { key: 'ssBands2', label: 'Cross bands', kind: 'slider', min: 0, max: 40, step: 1, default: 10, group: 'Warp', showIf: { key: 'ssMapDir', equals: 'crosshatch' } },
  { key: 'ssBandSpeed2', label: 'Cross band speed', kind: 'slider', min: 0, max: 6, step: 1, default: 2, group: 'Warp', showIf: { key: 'ssMapDir', equals: 'crosshatch' } },
  { key: 'ssSpeedMode2', label: 'Cross band pattern', kind: 'select', options: ['random', 'progressive'], default: 'random', group: 'Warp', showIf: { key: 'ssMapDir', equals: 'crosshatch' } },
  { key: 'ssEase2', label: 'Cross speed ease', kind: 'slider', min: 0, max: 1, step: 0.05, default: 1, group: 'Warp', showIf: { key: 'ssMapDir', equals: 'crosshatch' } },
  { key: 'ssBump', label: 'Bumps', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0, group: 'Warp' },
  { key: 'ssBumpFreq', label: 'Bump freq', kind: 'slider', min: 1, max: 10, step: 0.5, default: 3, group: 'Warp' },
  // MOTION — squish-wipe cycles per loop (integer ⇒ seamless). With one text line this is the pulse
  // rate; with multiple lines the melt rate is set by Cycle texts instead (each wipe = one line).
  { key: 'speed', label: 'Speed', kind: 'slider', min: 1, max: 8, step: 1, default: 2, group: 'Motion' },
  // How many full passes through the text lines per loop (each line melts into the next via a wipe).
  { key: 'ssTextCycle', label: 'Cycle texts', kind: 'slider', min: 1, max: 8, step: 1, default: 1, group: 'Motion' },
  // Freeze the animation and pose the warp by hand: 'static' replaces loop time with the Pose slider.
  { key: 'ssMotion', label: 'Motion', kind: 'select', options: ['animate', 'static'], default: 'animate', group: 'Motion' },
  { key: 'ssPhase', label: 'Pose (static)', kind: 'slider', min: 0, max: 1, step: 0.005, default: 0, group: 'Motion' },
  // TRANSFORM.
  { key: 'ssTileX', label: 'Clone columns', kind: 'slider', min: 1, max: 8, step: 1, default: 1, group: 'Transform' },
  { key: 'ssTileY', label: 'Clone rows', kind: 'slider', min: 1, max: 8, step: 1, default: 1, group: 'Transform' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Camera rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Camera rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  // COLOR.
  { key: 'textColor', label: 'Text', kind: 'color', default: '#ffffff', group: 'Color' },
  { key: 'bgColor', label: 'Background', kind: 'color', default: '#000000', group: 'Color' },
]

interface SlitState {
  material: THREE.ShaderMaterial
  numTexts: number       // text lines in the atlas (drives the melt rate + seamless wrap)
}
const MAXN = 16          // per-line metric arrays sent to the shader (lines beyond this don't cycle)
let state: SlitState | null = null

function n(p: Params, k: string): number { return Number(p[k]) }

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

const FRAG = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform sampler2D uText; uniform vec3 uTextColor; uniform vec3 uBg;',
  'uniform float uVMid; uniform float uVH; uniform float uN;',      // uN = number of text lines (atlas rows)
  'uniform float uWfArr[16]; uniform float uHSArr[16];',            // per-line ink-width frac + aspect inset
  'uniform float uTileX; uniform float uTileY;',                    // clone the word into a columns×rows grid
  'uniform float uTime; uniform float uSpeed; uniform float uDelay; uniform float uMapDir;',
  'uniform float uBump; uniform float uBumpFreq; uniform float uBands; uniform float uBandSpeed; uniform float uSpeedMode; uniform float uEase;',
  // Cross-axis band controls (crosshatch only): the second, perpendicular slit set.
  'uniform float uDelay2; uniform float uBands2; uniform float uBandSpeed2; uniform float uSpeedMode2; uniform float uEase2;',
  'const float TAU = 6.2831853;',
  'float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }',
  // The slit field for ONE axis at position `coord` with that axis's own band controls: returns
  // vec2(g = band time-offset 0..1, extra = per-band added speed). No bands → smooth (g = coord, no
  // extra). Random scrambles offset+speed per band; progressive is an ordered/eased offset, coherent speed.
  'vec2 bandField(float coord, float bands, float bandSpeed, float speedMode, float ease){',
  '  if (bands < 2.0) return vec2(coord, 0.0);',
  '  float band = floor(coord * bands);',
  '  float bn = band / max(1.0, bands - 1.0);',
  '  float bne = mix(bn, bn * bn * (3.0 - 2.0 * bn), ease);',           // eased band index (smoothstep)
  '  if (speedMode < 0.5) return vec2(hash(band * 2.3), floor(hash(band * 1.73) * (bandSpeed + 0.999)));',
  '  return vec2(bne, bandSpeed);',                                     // progressive: coherent speed
  '}',
  // Per-line metric lookup by row index (constant-bounded loop ⇒ valid dynamic access in GLSL ES).
  'float lookupWf(float row){ float v = 1.0; for (int i = 0; i < 16; i++){ if (float(i) == row) v = uWfArr[i]; } return v; }',
  'float lookupHS(float row){ float v = 1.0; for (int i = 0; i < 16; i++){ if (float(i) == row) v = uHSArr[i]; } return v; }',
  // glyph alpha for ONE line (wf/rowV/hs) at word-space x (tx∈[0,1]) and screen vy
  'float glyph(float tx, float vy, float wf, float rowV, float hs){',
  '  float txc = (tx - 0.5) / max(0.01, hs) + 0.5;',                // keep each line\'s aspect, centred in the plane
  '  if (txc < 0.0 || txc > 1.0) return 0.0;',
  '  float ix = txc * wf;',
  '  float iy = uVMid + rowV + (vy - 0.5) * uVH * 1.35;',           // rowV picks the line\'s atlas row
  '  if (ix < 0.0 || ix > wf || iy < 0.0 || iy > 1.0) return 0.0;',
  '  return texture2D(uText, vec2(clamp(ix, 0.0, 1.0), clamp(iy, 0.0, 1.0))).a;',
  '}',
  // base squish-wipe at normalized time tau: copy A shrinks to the left, copy B grows from the right.
  // The MELT: copy A shows line floor(tau), copy B shows line floor(tau)+1, so as the wipe completes
  // the current line vanishes and the next fills in — one line at a time, no overlap. The squish
  // minifies hard, so supersample across the horizontal footprint (dFdx) — dFdx (not fwidth) avoids
  // the vertical band-boundary spike.
  'float base(vec2 uv, float tau){',
  '  float k = floor(tau);',
  '  float p = fract(tau);',
  '  float b = 1.0 - p;',
  '  bool inA = uv.x < b;',
  '  float tx = inA ? uv.x / max(1e-3, b) : (uv.x - b) / max(1e-3, p);',
  '  float row = inA ? mod(k, uN) : mod(k + 1.0, uN);',             // shrinking = current line, growing = next
  // Cells are undistorted because the PLANE aspect is fit to the grid (word × columns/rows), so
  // each cell already has the word's aspect — no per-cell correction needed here.
  '  float wf = lookupWf(row); float hs = lookupHS(row); float rowV = row / max(1.0, uN);',
  '  float foot = clamp(abs(dFdx(tx)), 0.0, 0.25);',
  '  float a = 0.0;',
  '  for (int i = 0; i < 5; i++) a += glyph(tx + (float(i) - 2.0) * foot, uv.y, wf, rowV, hs);',
  '  return a * 0.2;',
  '}',
  'void main(){',
  // Per-axis slit field → a time offset (phase, in cycles) = bandField.g × that axis\'s OWN delay,
  // plus an added speed. Crosshatch SUMS both axes (a 2D grid of slits) — each with independent
  // bands/speed/pattern/ease/delay. Progressive caps each axis\'s span so the squish base (period 1)
  // never wraps; halved in crosshatch so the two progressive offsets still sum under one cycle.
  '  bool cross = uMapDir > 1.5;',
  '  float capA = cross ? 0.46 : 0.92;',
  '  float dlyA = (uSpeedMode < 0.5) ? uDelay : min(uDelay, capA);',
  '  float dlyB = (uSpeedMode2 < 0.5) ? uDelay2 : min(uDelay2, 0.46);',
  '  float phase; float extra;',
  '  if (uMapDir < 0.5) { vec2 f = bandField(vUv.y, uBands, uBandSpeed, uSpeedMode, uEase); phase = f.x * dlyA; extra = f.y; }',      // vertical → horizontal slits
  '  else if (uMapDir < 1.5) { vec2 f = bandField(vUv.x, uBands, uBandSpeed, uSpeedMode, uEase); phase = f.x * dlyA; extra = f.y; }', // horizontal → vertical slits
  '  else {',                                                                                                                          // crosshatch: both axes
  '    vec2 fy = bandField(vUv.y, uBands, uBandSpeed, uSpeedMode, uEase);',                  // primary axis = Y → horizontal slits
  '    vec2 fx = bandField(vUv.x, uBands2, uBandSpeed2, uSpeedMode2, uEase2);',              // cross axis = X → vertical slits
  '    phase = fy.x * dlyA + fx.x * dlyB; extra = fy.y + fx.y;',
  '  }',
  // Multi-line: scale added speed to a multiple of the line count so every band advances a whole
  // number of full passes per loop (word index returns to start ⇒ seamless).
  '  if (uN > 1.5) extra *= uN;',
  '  float spd = uSpeed + extra;',
  '  float dlyBump = cross ? (dlyA + dlyB) * 0.5 : dlyA;',
  '  phase += uBump * 0.5 * sin(vUv.x * TAU * uBumpFreq) * sin(vUv.y * TAU * uBumpFreq) * dlyBump;',
  '  float tau = uTime * spd - phase;',                                // per-pixel TIME offset
  // Clone into a grid: tile the SAMPLE coord (each cell runs a full melt) while the displacement
  // field above stays global, so the slit-scan plays continuously across all clones.
  '  vec2 tuv = vec2(fract(vUv.x * uTileX), fract(vUv.y * uTileY));',
  '  float a = base(tuv, tau);',                                       // melts line floor(tau) → floor(tau)+1
  '  vec3 col = mix(uBg, uTextColor, a);',
  '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);',
  '}',
].join('\n')

export const slitScanEffect: SpaceTypeEffect = {
  id: 'slitscan',
  label: 'Slit Scan',
  controls,
  liveKeys: ['ssDelay', 'ssMapDir', 'ssBump', 'ssBumpFreq', 'ssBands', 'ssBandSpeed', 'ssSpeedMode',
    'ssEase', 'ssDelay2', 'ssBands2', 'ssBandSpeed2', 'ssSpeedMode2', 'ssEase2', 'ssTextCycle', 'ssMotion', 'ssPhase'],

  buildScene(three, params, textTexture, env) {
    const root = new three.Group()
    const tex = textTexture.clone()
    tex.wrapS = tex.wrapT = three.ClampToEdgeWrapping
    // No mipmaps: the per-band time jumps spike the GPU's LOD derivative → coarse-mip gray streaks.
    // Squish minification is anti-aliased manually in the shader (dFdx supersample) instead.
    tex.minFilter = three.LinearFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true

    const ud = textTexture.userData ?? {}
    const img = textTexture.image as { width?: number; height?: number } | undefined
    const texAspect = Math.max(0.1, (img?.width ?? 1) / (img?.height ?? 1))
    const inkVH = Math.max(0.05, Number(ud.inkHeightFrac ?? 0.6))
    const inkVMid = Number(ud.inkVMid ?? 0.5)
    // One atlas row per text line; the wipe melts through them over the loop. Each row's ink box has
    // its own aspect (texAspect scoped to that line's ink width ÷ ink height); fit the plane to the
    // WIDEST so every line fits, and inset narrower lines via uHScale so they keep their proportion.
    const wordInk = (ud.wordInkFracs as number[] | undefined)?.length ? (ud.wordInkFracs as number[]) : [1]
    const wordFr = (ud.wordFracs as number[] | undefined)?.length ? (ud.wordFracs as number[]) : [1]
    const numTexts = Math.max(1, Math.floor(Number(ud.numTexts ?? wordInk.length)))
    const aspects = Array.from({ length: numTexts }, (_, k) =>
      Math.max(0.05, ((wordFr[k] ?? 1) * (wordInk[k] ?? 1) * texAspect) / inkVH))
    const wordAspect = Math.max(...aspects)
    // Per-line metric arrays for the shader (padded to MAXN; rows beyond numTexts are never sampled).
    const wfArr = Array.from({ length: MAXN }, (_, k) => Number(wordInk[k] ?? 1) || 1)
    const hsArr = Array.from({ length: MAXN }, (_, k) => Math.max(0.01, (aspects[k] ?? wordAspect) / wordAspect))
    // Clone grid: the overall block aspect = word aspect × (columns / rows). Fitting the PLANE to
    // this makes every cell carry the word's own aspect (no per-cell correction needed).
    const tileX = Math.max(1, Math.round(n(params, 'ssTileX') || 1))
    const tileY = Math.max(1, Math.round(n(params, 'ssTileY') || 1))
    const gridAspect = wordAspect * (tileX / tileY)
    // Fit the plane to FILL the camera view (was a fixed BOX=9, which left big margins in wide
    // outputs — a clone grid looked tiny). VIEW_H mirrors the engine's z=14 / 45°-FOV framing at
    // scale 1; the user's Scale then zooms on top. Contain the grid aspect within the view.
    const VIEW_H = Math.tan((45 / 2) * Math.PI / 180) * 14 * 2   // ≈ 11.6 world units tall at scale 1
    const FILL = 0.96
    const viewAspect = Math.max(0.1, (env?.width ?? 1) / (env?.height ?? 1))
    const viewW = VIEW_H * viewAspect
    const fitW = gridAspect >= viewAspect       // grid wider than the frame → width-limited
    const planeW = fitW ? viewW * FILL : VIEW_H * FILL * gridAspect
    const planeH = fitW ? (viewW * FILL) / gridAspect : VIEW_H * FILL

    const material = new three.ShaderMaterial({
      side: three.DoubleSide,
      uniforms: {
        uText: { value: tex },
        uTextColor: { value: new three.Color(String(params.textColor)) },
        uBg: { value: new three.Color(String(params.bgColor)) },
        uVMid: { value: inkVMid }, uVH: { value: inkVH }, uN: { value: numTexts },
        uWfArr: { value: wfArr }, uHSArr: { value: hsArr },
        uTileX: { value: tileX }, uTileY: { value: tileY },
        uTime: { value: 0 }, uSpeed: { value: 2 }, uDelay: { value: 1.5 }, uMapDir: { value: 0 },
        uBump: { value: 0 }, uBumpFreq: { value: 3 }, uBands: { value: 10 }, uBandSpeed: { value: 2 }, uSpeedMode: { value: 0 }, uEase: { value: 1 },
        uDelay2: { value: 1.5 }, uBands2: { value: 10 }, uBandSpeed2: { value: 2 }, uSpeedMode2: { value: 0 }, uEase2: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,   // dFdx (used for squish anti-alias) is built in under WebGL2
    })
    const mesh = new three.Mesh(new three.PlaneGeometry(planeW, planeH), material)
    mesh.userData.tex = tex
    root.add(mesh)

    state = { material, numTexts }
    slitScanEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const u = s.material.uniforms
    // 'static' freezes the animation and poses the warp by hand via the Pose slider (replaces loop time).
    u.uTime!.value = String(params.ssMotion) === 'static' ? Math.max(0, n(params, 'ssPhase')) : t01
    // One squish-wipe melts one line into the next. With N lines, run `cycles` full passes per loop
    // → N*cycles wipes (a multiple of N, so the line index returns to start ⇒ seamless). One line:
    // the wipe just pulses at the Speed rate (no melt, since floor(tau) mod 1 = 0 always).
    const N = s.numTexts
    const cycles = Math.max(1, Math.round(n(params, 'ssTextCycle') || 1))
    u.uSpeed!.value = N > 1 ? N * cycles : Math.max(1, Math.round(n(params, 'speed')))
    u.uTileX!.value = Math.max(1, Math.round(n(params, 'ssTileX') || 1))
    u.uTileY!.value = Math.max(1, Math.round(n(params, 'ssTileY') || 1))
    u.uDelay!.value = Math.max(0, n(params, 'ssDelay'))
    u.uMapDir!.value = String(params.ssMapDir) === 'crosshatch' ? 2 : String(params.ssMapDir) === 'horizontal' ? 1 : 0
    u.uBump!.value = Math.max(0, n(params, 'ssBump'))
    u.uBumpFreq!.value = Math.max(1, n(params, 'ssBumpFreq'))
    u.uBands!.value = Math.max(0, Math.round(n(params, 'ssBands')))
    u.uBandSpeed!.value = Math.max(0, Math.round(n(params, 'ssBandSpeed')))
    u.uSpeedMode!.value = String(params.ssSpeedMode) === 'progressive' ? 1 : 0
    u.uEase!.value = Math.min(1, Math.max(0, n(params, 'ssEase')))
    // Cross axis (crosshatch). Configs saved before these params existed lack the ss*2 keys → reading
    // them gives NaN, which would poison tau and render BLACK. Fall back to the primary axis value
    // (mirrors it) whenever a cross param is missing/non-finite.
    const num2 = (k: string, fallback: number): number => { const v = Number(params[k]); return Number.isFinite(v) ? v : fallback }
    u.uDelay2!.value = Math.max(0, num2('ssDelay2', n(params, 'ssDelay')))
    u.uBands2!.value = Math.max(0, Math.round(num2('ssBands2', n(params, 'ssBands'))))
    u.uBandSpeed2!.value = Math.max(0, Math.round(num2('ssBandSpeed2', n(params, 'ssBandSpeed'))))
    u.uSpeedMode2!.value = String(params.ssSpeedMode2 ?? params.ssSpeedMode) === 'progressive' ? 1 : 0
    u.uEase2!.value = Math.min(1, Math.max(0, num2('ssEase2', n(params, 'ssEase'))))
    ;(u.uTextColor!.value as THREE.Color).set(String(params.textColor))
    ;(u.uBg!.value as THREE.Color).set(String(params.bgColor))
  },
}
