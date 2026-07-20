/**
 * Live-preview (scrub) node types — the local, deterministic image/video ops
 * that auto-run on widget change (debounced) so the preview refreshes without
 * the user clicking Run.
 *
 * Shared by:
 *  - ComfyNode.vue — suppresses the per-node Run button and drives the
 *    auto-run watch for these types.
 *  - VueNodeCanvas.vue — excludes their `executed` emissions from take
 *    capture. They write ONE fixed-name temp file per node
 *    (`live_preview_<id>.png`, overwritten every run — see
 *    comfy_extras/_live_preview.py), so capturing each emission as a take
 *    builds a filmstrip of aliases to a single mutable file: picking an older
 *    take shows stale browser-cached pixels while downstream runs read the
 *    newest content. Their display refreshes; no takes accumulate.
 *
 * Result-emitting nodes (BackgroundRemove, Compositor, Timeline, Upscale, …)
 * are intentionally NOT here — their emissions use unique temp filenames
 * (save_live_preview(..., unique=True)) so takes stay real, immutable files.
 */
export const LIVE_PREVIEW_NODE_TYPES: Set<string> = new Set([
  // Tone
  'AdjustBrightnessContrast', 'AdjustExposure', 'AdjustCurves', 'AdjustLevels',
  'AdjustShadowsHighlights', 'AdjustVignette', 'AdjustGlow',
  // Color
  'AdjustColor', 'AdjustTemperature', 'AdjustVibrance', 'AdjustColorBalance',
  'AdjustBlackWhite', 'AdjustPhotoFilter', 'AdjustGradientMap', 'AdjustChannelMixer',
  'AdjustInvert', 'AdjustPosterize', 'AdjustThreshold',
  // Sharpen & noise
  'Sharpen', 'AddNoise', 'Denoise',
  // Blur
  'Blur',
  // Geometry
  'CropImage', 'ResizeImage', 'RotateImage', 'FlipImage',
  // Distortion
  'Pinch', 'Twirl', 'Wave', 'LensCorrection',
  // Stylize
  'Pixelate', 'FindEdges', 'Emboss', 'HighPass',
  // Composite (multi-image)
  'Blend', 'ApplyMask', 'ThresholdMask', 'ColorRangeMask',
  'MatteGrowShrink', 'MergeAlpha', 'MaskByText', 'MaskExtractor',
  // Shader-style
  'ChromaticAberration', 'Halftone', 'CRT', 'Bokeh',
  'Kuwahara', 'CrossHatch', 'Dither', 'Ascii',
  'PerlinNoise', 'Voronoi', 'GradientGenerator',
  'Kaleidoscope', 'PolarCoords', 'Glitch', 'Fisheye',
  'Duotone', 'SplitToning',
  'GodRays', 'LensFlare', 'LightLeak', 'FilmGrain',
  // Round 3
  'ReactionDiffusion', 'Fractal',
  'TiltShift', 'FrequencySeparation', 'PaletteQuantize',
  'HeightmapRelief', 'Caustics', 'Blinds',
  // Unicorn batch
  'GradientMap', 'Posterize', 'Outline', 'Mirror', 'Hologram',
  'Stipple', 'Sparkle', 'TwoDLight', 'FlowField',
  // Video effects
  'FrameTrail', 'TemporalMotionBlur', 'SlitScan', 'TimeDisplacement',
  'VideoReverse', 'VideoTrim', 'VideoCrossfade', 'AnimatedNoise',
  // Video pro
  'SpeedRamp', 'KenBurns', 'AspectConvert', 'ChromaKey', 'CaptionTrack',
  'LUT', 'ThreeWayCC', 'AudioWaveform', 'Transition', 'Stabilize',
  // Timeline edits client-side via the modal (canvas + <video>); the backend
  // renderer only runs on explicit Render or when downstream consumers need it.
  // Compositor also renders client-side.
  // SmartLayout — render service is local (Nuxt /api/templates/render),
  // typical layouts complete in under a second. Re-renders one image per
  // aspect on each change; shorten `aspects` to "1x1" while editing if you
  // want faster turnaround.
  'SmartLayout',
  // Depth-based lens / DoF (auto-reruns; depth is cached so reruns are render-only)
  'LensBlur',
  // NOTE: LensReframe is intentionally NOT here — it regenerates via a paid cloud
  // image model (nano-banana-2), so it runs only on explicit Run, not on every tweak.
])
