<script setup lang="ts">
const props = defineProps<{
  widgetDef: {
    name: string
    type: string
    options?: string[]
    min?: number
    max?: number
    step?: number
    default?: any
    tooltip?: string
    // Backend-provided UI hint. When set, overrides the type-based renderer
    // pick below. Only "model_picker" is recognised today — opens the model
    // gallery modal instead of showing a plain combo dropdown. Backend ships
    // this via IO.Combo.Input(..., extra_dict={"comfynext_widget": "model_picker"}).
    comfynext_widget?: string
  }
  modelValue: any
  nodeType?: string
  // Forwarded to widgets that dispatch global open-modal events (model_picker).
  // The modal mount point reads detail.nodeId to know which node it's editing.
  nodeId?: string
  // Lock state for seed widgets. When true, the pre-Run randomizer leaves
  // this seed alone. The parent (ComfyNode.vue) decides where the boolean
  // lives — widgets_values[i+1] for Comfy-standard seeds (control_after_generate)
  // or node.properties.seedLocks for everything else — and presents it here
  // as a single bool so this component doesn't have to know the split.
  isFixed?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: any]
  'update:isFixed': [value: boolean]
}>()

const isCombo = computed(() => Array.isArray(props.widgetDef.options) || props.widgetDef.type === 'COMBO')
const isNumber = computed(() => ['INT', 'FLOAT'].includes(props.widgetDef.type))
const isToggle = computed(() => props.widgetDef.type === 'BOOLEAN')
const isSeed = computed(() => props.widgetDef.name.toLowerCase().includes('seed'))
const isText = computed(() => props.widgetDef.type === 'STRING')

// Per-node gradient slider configs. Keys: nodeType → widget name → gradient CSS.
const GRADIENT_WIDGETS: Record<string, Record<string, string>> = {
  AdjustColor: {
    hue: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
    saturation: 'linear-gradient(to right, #808080, #ff0000)',
    lightness: 'linear-gradient(to right, #000000, #808080 50%, #ffffff)',
  },
  AdjustBrightnessContrast: {
    brightness: 'linear-gradient(to right, #000000, #808080 50%, #ffffff)',
    contrast: 'linear-gradient(to right, #6b6b6b, #404040 50%, #f0f0f0)',
  },
  AdjustExposure: {
    exposure: 'linear-gradient(to right, #0a0a0a, #808080 50%, #fff8e0)',
  },
  AdjustCurves: {
    blacks: 'linear-gradient(to right, #000000, #2a2a2a 50%, #555555)',
    midtones: 'linear-gradient(to right, #555555, #888888 50%, #bbbbbb)',
    whites: 'linear-gradient(to right, #aaaaaa, #dddddd 50%, #ffffff)',
  },
  AdjustLevels: {
    black: 'linear-gradient(to right, #000000, #444444 50%, #888888)',
    gamma: 'linear-gradient(to right, #555555, #888888 50%, #bbbbbb)',
    white: 'linear-gradient(to right, #888888, #cccccc 50%, #ffffff)',
  },
  Blur: {
    radius: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    angle: 'linear-gradient(to right, #ff6b6b, #ffd166 25%, #06d6a0 50%, #118ab2 75%, #ff6b6b 100%)',
    length: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    strength: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },

  // Tone extras
  AdjustVignette: {
    amount: 'linear-gradient(to right, #000000, #555555 50%, #ffffff)',
    feather: 'linear-gradient(to right, #555555, #888888 50%, #bbbbbb)',
  },
  AdjustGlow: {
    threshold: 'linear-gradient(to right, #000000, #888888 50%, #ffffff)',
    intensity: 'linear-gradient(to right, #2a2a2a, #888866 50%, #ffff99)',
    radius: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  AdjustShadowsHighlights: {
    shadows: 'linear-gradient(to right, #000000, #2a2a2a 50%, #555555)',
    highlights: 'linear-gradient(to right, #aaaaaa, #dddddd 50%, #ffffff)',
  },

  // Color filters
  AdjustTemperature: {
    temperature: 'linear-gradient(to right, #2060ff, #888888 50%, #ffb050)',
    tint: 'linear-gradient(to right, #50dd50, #888888 50%, #dd50dd)',
  },
  AdjustVibrance: {
    amount: 'linear-gradient(to right, #808080, #cc8080 50%, #ff3030)',
  },
  AdjustColorBalance: {
    shadows_cr:    'linear-gradient(to right, #00aaaa, #444444 50%, #ff3030)',
    shadows_mg:    'linear-gradient(to right, #ff30ff, #444444 50%, #30ff30)',
    shadows_yb:    'linear-gradient(to right, #ffff30, #444444 50%, #3030ff)',
    midtones_cr:   'linear-gradient(to right, #00aaaa, #888888 50%, #ff3030)',
    midtones_mg:   'linear-gradient(to right, #ff30ff, #888888 50%, #30ff30)',
    midtones_yb:   'linear-gradient(to right, #ffff30, #888888 50%, #3030ff)',
    highlights_cr: 'linear-gradient(to right, #00aaaa, #cccccc 50%, #ff3030)',
    highlights_mg: 'linear-gradient(to right, #ff30ff, #cccccc 50%, #30ff30)',
    highlights_yb: 'linear-gradient(to right, #ffff30, #cccccc 50%, #3030ff)',
  },
  AdjustBlackWhite: {
    red:   'linear-gradient(to right, #555555, #ff6060)',
    green: 'linear-gradient(to right, #555555, #60ff60)',
    blue:  'linear-gradient(to right, #555555, #6060ff)',
  },
  AdjustPhotoFilter: {
    density: 'linear-gradient(to right, #555555, #888888 50%, #ffcc66)',
  },
  AdjustGradientMap: {
    shadow_r:    'linear-gradient(to right, #000000, #ff3030)',
    shadow_g:    'linear-gradient(to right, #000000, #30ff30)',
    shadow_b:    'linear-gradient(to right, #000000, #3030ff)',
    highlight_r: 'linear-gradient(to right, #555555, #ff6060)',
    highlight_g: 'linear-gradient(to right, #555555, #60ff60)',
    highlight_b: 'linear-gradient(to right, #555555, #6060ff)',
    mix:         'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  AdjustChannelMixer: {
    r_from_r: 'linear-gradient(to right, #2a2a2a, #888888 33%, #ff3030)',
    r_from_g: 'linear-gradient(to right, #2a2a2a, #888888 33%, #ff3030)',
    r_from_b: 'linear-gradient(to right, #2a2a2a, #888888 33%, #ff3030)',
    g_from_r: 'linear-gradient(to right, #2a2a2a, #888888 33%, #30ff30)',
    g_from_g: 'linear-gradient(to right, #2a2a2a, #888888 33%, #30ff30)',
    g_from_b: 'linear-gradient(to right, #2a2a2a, #888888 33%, #30ff30)',
    b_from_r: 'linear-gradient(to right, #2a2a2a, #888888 33%, #3030ff)',
    b_from_g: 'linear-gradient(to right, #2a2a2a, #888888 33%, #3030ff)',
    b_from_b: 'linear-gradient(to right, #2a2a2a, #888888 33%, #3030ff)',
  },
  AdjustInvert: {
    amount: 'linear-gradient(to right, #000000, #888888 50%, #ffffff)',
  },
  AdjustThreshold: {
    threshold: 'linear-gradient(to right, #000000, #888888 50%, #ffffff)',
  },

  // Sharpen & noise
  Sharpen: {
    amount: 'linear-gradient(to right, #444444, #888888 50%, #ffffff)',
    radius: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  AddNoise: {
    amount: 'linear-gradient(to right, #2a2a2a, #888888 50%, #cccccc)',
  },
  Denoise: {
    strength: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },

  // Geometry
  CropImage: {
    left:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    right:  'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    top:    'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    bottom: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  ResizeImage: {
    scale: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  RotateImage: {
    angle: 'linear-gradient(to right, #ff6b6b, #ffd166 25%, #06d6a0 50%, #118ab2 75%, #ff6b6b 100%)',
  },

  // Distortion
  Pinch: {
    amount: 'linear-gradient(to right, #2060ff, #888888 50%, #ff6060)',
  },
  Twirl: {
    angle: 'linear-gradient(to right, #ff6b6b, #ffd166 25%, #06d6a0 50%, #118ab2 75%, #ff6b6b 100%)',
  },
  Wave: {
    amplitude:  'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    wavelength: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  LensCorrection: {
    distortion: 'linear-gradient(to right, #2060ff, #888888 50%, #ff6060)',
  },

  // Stylize
  Pixelate: {
    size: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  FindEdges: {
    intensity: 'linear-gradient(to right, #2a2a2a, #888888 50%, #ffffff)',
  },
  Emboss: {
    depth: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  HighPass: {
    radius: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },

  // Composite
  Blend: {
    opacity: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  ThresholdMask: {
    threshold: 'linear-gradient(to right, #000000, #888888 50%, #ffffff)',
    softness: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  ColorRangeMask: {
    target_r:  'linear-gradient(to right, #000000, #ff3030)',
    target_g:  'linear-gradient(to right, #000000, #30ff30)',
    target_b:  'linear-gradient(to right, #000000, #3030ff)',
    tolerance: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },

  // Lens
  ChromaticAberration: { amount: 'linear-gradient(to right, #ff3030, #888888 50%, #3030ff)' },
  Halftone: {
    cell_size: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    angle: 'linear-gradient(to right, #ff6b6b, #ffd166 25%, #06d6a0 50%, #118ab2 75%, #ff6b6b 100%)',
  },
  CRT: {
    scanlines: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    rgb_mask:  'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    chroma:    'linear-gradient(to right, #ff3030, #888888 50%, #3030ff)',
    curvature: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  Bokeh: {
    radius:           'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    highlight_boost:  'linear-gradient(to right, #555555, #888866 50%, #ffff99)',
  },

  // Painterly
  Kuwahara: { radius: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)' },
  CrossHatch: {
    density:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    threshold: 'linear-gradient(to right, #000000, #888888 50%, #ffffff)',
  },
  Dither: { /* int slider, no gradient needed beyond default */ },

  // Generative
  PerlinNoise: {
    scale:       'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    persistence: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  Voronoi: {
    edge_width: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  GradientGenerator: {
    angle:   'linear-gradient(to right, #ff6b6b, #ffd166 25%, #06d6a0 50%, #118ab2 75%, #ff6b6b 100%)',
    start_r: 'linear-gradient(to right, #000000, #ff3030)',
    start_g: 'linear-gradient(to right, #000000, #30ff30)',
    start_b: 'linear-gradient(to right, #000000, #3030ff)',
    end_r:   'linear-gradient(to right, #000000, #ff3030)',
    end_g:   'linear-gradient(to right, #000000, #30ff30)',
    end_b:   'linear-gradient(to right, #000000, #3030ff)',
  },

  // Warp
  Kaleidoscope: {
    rotation: 'linear-gradient(to right, #ff6b6b, #ffd166 25%, #06d6a0 50%, #118ab2 75%, #ff6b6b 100%)',
  },
  Glitch: {
    intensity: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  Fisheye: {
    amount: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },

  // Grading
  Duotone: {
    shadow_r:    'linear-gradient(to right, #000000, #ff3030)',
    shadow_g:    'linear-gradient(to right, #000000, #30ff30)',
    shadow_b:    'linear-gradient(to right, #000000, #3030ff)',
    highlight_r: 'linear-gradient(to right, #555555, #ff6060)',
    highlight_g: 'linear-gradient(to right, #555555, #60ff60)',
    highlight_b: 'linear-gradient(to right, #555555, #6060ff)',
  },
  SplitToning: {
    shadow_r:    'linear-gradient(to right, #000000, #ff3030)',
    shadow_g:    'linear-gradient(to right, #000000, #30ff30)',
    shadow_b:    'linear-gradient(to right, #000000, #3030ff)',
    highlight_r: 'linear-gradient(to right, #555555, #ff6060)',
    highlight_g: 'linear-gradient(to right, #555555, #60ff60)',
    highlight_b: 'linear-gradient(to right, #555555, #6060ff)',
    balance:     'linear-gradient(to right, #2060ff, #888888 50%, #ffb050)',
    intensity:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },

  // Atmosphere
  GodRays: {
    threshold: 'linear-gradient(to right, #000000, #888888 50%, #ffffff)',
    intensity: 'linear-gradient(to right, #2a2a2a, #888866 50%, #ffff99)',
    center_x:  'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    center_y:  'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  LightLeak: {
    angle:     'linear-gradient(to right, #ff6b6b, #ffd166 25%, #06d6a0 50%, #118ab2 75%, #ff6b6b 100%)',
    position:  'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    softness:  'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    intensity: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    color_r:   'linear-gradient(to right, #000000, #ff3030)',
    color_g:   'linear-gradient(to right, #000000, #30ff30)',
    color_b:   'linear-gradient(to right, #000000, #3030ff)',
  },
  FilmGrain: {
    amount: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    size:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  LensFlare: {
    light_x:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    light_y:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    intensity: 'linear-gradient(to right, #555555, #888866 50%, #ffff99)',
    halo_size: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    streak:    'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    color_r:   'linear-gradient(to right, #000000, #ff3030)',
    color_g:   'linear-gradient(to right, #000000, #30ff30)',
    color_b:   'linear-gradient(to right, #000000, #3030ff)',
  },

  // Round 3
  ReactionDiffusion: {
    feed: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    kill: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  Fractal: {
    center_x:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    center_y:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    julia_cx:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    julia_cy:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    palette_r:  'linear-gradient(to right, #000000, #ff3030)',
    palette_g:  'linear-gradient(to right, #000000, #30ff30)',
    palette_b:  'linear-gradient(to right, #000000, #3030ff)',
  },
  TiltShift: {
    position: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    width:    'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    blur:     'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  FrequencySeparation: {
    radius: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  PaletteQuantize: { /* int-only widgets */ },
  HeightmapRelief: {
    angle:     'linear-gradient(to right, #ff6b6b, #ffd166 25%, #06d6a0 50%, #118ab2 75%, #ff6b6b 100%)',
    elevation: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #ffffaa)',
    depth:     'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    ambient:   'linear-gradient(to right, #000000, #888888 50%, #ffffff)',
  },
  Caustics: {
    scale:     'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    intensity: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    color_r:   'linear-gradient(to right, #000000, #ff3030)',
    color_g:   'linear-gradient(to right, #000000, #30ff30)',
    color_b:   'linear-gradient(to right, #000000, #3030ff)',
  },
  Blinds: {
    openness: 'linear-gradient(to right, #000000, #888888 50%, #ffffff)',
    shadow:   'linear-gradient(to right, #000000, #6b6b6b 50%, #cccccc)',
    softness: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    angle:    'linear-gradient(to right, #ff6b6b, #ffd166 25%, #06d6a0 50%, #118ab2 75%, #ff6b6b 100%)',
  },

  MatteGrowShrink: {
    amount:  'linear-gradient(to right, #2060ff, #888888 50%, #ff6060)',
    feather: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  MaskByText: {
    threshold: 'linear-gradient(to right, #000000, #888888 50%, #ffffff)',
    feather:   'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },
  MaskExtractor: {
    click_x: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    click_y: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
    feather: 'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)',
  },

  // Compositor — same gradient set for each of the 4 layers
  Compositor: Object.fromEntries(
    [1, 2, 3, 4].flatMap((i) => [
      [`layer${i}_x`,        'linear-gradient(to right, #2060ff, #888888 50%, #ff6060)'],
      [`layer${i}_y`,        'linear-gradient(to right, #2060ff, #888888 50%, #ff6060)'],
      [`layer${i}_rotation`, 'linear-gradient(to right, #ff6b6b, #ffd166 25%, #06d6a0 50%, #118ab2 75%, #ff6b6b 100%)'],
      [`layer${i}_scale`,    'linear-gradient(to right, #2a2a2a, #6b6b6b 50%, #cccccc)'],
      [`layer${i}_opacity`,  'linear-gradient(to right, #000000, #888888 50%, #ffffff)'],
    ])
  ),
}

const gradient = computed(() => {
  if (!props.nodeType || !isNumber.value) return null
  return GRADIENT_WIDGETS[props.nodeType]?.[props.widgetDef.name] ?? null
})

// Widget names that semantically count frames. Anything matching here gets
// "(frames)" appended to the label so users aren't guessing the unit.
const FRAME_WIDGET_NAMES = new Set([
  'duration', 'length', 'total_duration', 'frame_count',
  'start', 'start_frame', 'end_frame',
  'fade_in', 'fade_out',
  'radius',  // for TemporalMotionBlur — also frames
])

function isFrameWidget(name: string): boolean {
  return FRAME_WIDGET_NAMES.has(name)
}

function formatLabel(name: string): string {
  const pretty = name
    .split(/[_\s]+/)
    .map((word, i) => i === 0
      ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      : word.toLowerCase()
    )
    .join(' ')
  return isFrameWidget(name) ? `${pretty} (frames)` : pretty
}
</script>
<template>
  <div class="px-2" data-slot="comfy-node-field">
    <!-- Backend-marked custom widget: skip the standard label + renderer chain
         and hand the whole slot to the model picker (it owns its own label).
         `video_model_picker` is the same widget pointed at the video catalog. -->
    <template v-if="widgetDef.comfynext_widget === 'model_picker' || widgetDef.comfynext_widget === 'video_model_picker' || widgetDef.comfynext_widget === 'text_effect_picker' || widgetDef.comfynext_widget === 'shot_preset_picker'">
      <VueCanvasWidgetsWidgetModelPicker
        :model-value="modelValue"
        :node-id="nodeId"
        :kind="widgetDef.comfynext_widget === 'video_model_picker' ? 'video' : widgetDef.comfynext_widget === 'text_effect_picker' ? 'text_effect' : widgetDef.comfynext_widget === 'shot_preset_picker' ? 'shot_preset' : 'image'"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
    <!-- LoRA gallery launcher: replaces the lora_name dropdown with a button
         that opens the visual LoRA gallery modal. -->
    <template v-else-if="widgetDef.comfynext_widget === 'lora_picker'">
      <VueCanvasWidgetsWidgetLoraPicker
        :model-value="modelValue"
        :node-id="nodeId"
        :widget-name="widgetDef.name"
        :kind="(widgetDef as any).lora_kind === 'character' ? 'character' : 'style'"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
    <!-- 3-axis camera gimbal: drives RotateCameraNode. The widget owns its
         own label and produces a JSON string {yaw,pitch,roll}. `nodeId` is
         forwarded so the widget can look up the connected image and render
         it inside the gimbal as a reference plane. -->
    <template v-else-if="widgetDef.comfynext_widget === 'camera_gimbal'">
      <VueCanvasWidgetsWidgetCameraGimbal
        :model-value="modelValue"
        :node-id="nodeId"
        :label="formatLabel(widgetDef.name)"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
    <!-- Variable-font playground: drives RenderType. Owns its full UI and
         produces a JSON state blob (font, axes, colors, uploaded filename). -->
    <template v-else-if="widgetDef.comfynext_widget === 'font_playground'">
      <VueCanvasWidgetsWidgetFontPlayground
        :model-value="modelValue"
        :label="formatLabel(widgetDef.name)"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
    <!-- Kinetic Typography: animated text with GSAP SplitText. Produces a
         JSON state blob (text, preset, font, animation params, frame filenames). -->
    <template v-else-if="widgetDef.comfynext_widget === 'kinetic_type'">
      <VueCanvasWidgetsWidgetKineticType
        :model-value="modelValue"
        :node-id="nodeId"
        :label="formatLabel(widgetDef.name)"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
    <!-- Text Mask: renders text as a B&W clipping mask. Same font infra
         as Font Playground, always white-on-black (or inverted). -->
    <template v-else-if="widgetDef.comfynext_widget === 'text_mask'">
      <VueCanvasWidgetsWidgetTextMask
        :model-value="modelValue"
        :label="formatLabel(widgetDef.name)"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
    <!-- Text on Path: renders text along an arc/circle/wave/curve. -->
    <template v-else-if="widgetDef.comfynext_widget === 'text_on_path'">
      <VueCanvasWidgetsWidgetTextOnPath
        :model-value="modelValue"
        :label="formatLabel(widgetDef.name)"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
    <template v-else-if="gradient">
      <VueCanvasWidgetsWidgetGradientSlider
        :label="formatLabel(widgetDef.name)"
        :model-value="modelValue"
        :min="widgetDef.min ?? 0"
        :max="widgetDef.max ?? 1"
        :step="widgetDef.step"
        :is-float="widgetDef.type === 'FLOAT'"
        :gradient="gradient"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
    <template v-else>
      <label
        class="text-[9px] text-muted-foreground tracking-normal mb-0.5 flex items-center gap-1"
        :title="widgetDef.tooltip || undefined"
      >
        <span>{{ formatLabel(widgetDef.name) }}</span>
        <span
          v-if="widgetDef.tooltip"
          class="inline-flex items-center justify-center size-3 rounded-full border border-white/15 text-white/30 text-[8px] leading-none cursor-help"
          aria-label="Info"
        >?</span>
      </label>
      <VueCanvasWidgetsWidgetCombo v-if="isCombo" :options="widgetDef.options || []" :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" />
      <VueCanvasWidgetsWidgetSeed
        v-else-if="isSeed && isNumber"
        :model-value="modelValue"
        :max="widgetDef.max"
        :is-fixed="isFixed"
        @update:model-value="emit('update:modelValue', $event)"
        @update:is-fixed="emit('update:isFixed', $event)"
      />
      <VueCanvasWidgetsWidgetNumber v-else-if="isNumber" :model-value="modelValue" :min="widgetDef.min" :max="widgetDef.max" :step="widgetDef.step" :is-float="widgetDef.type === 'FLOAT'" :name="widgetDef.name" @update:model-value="emit('update:modelValue', $event)" />
      <VueCanvasWidgetsWidgetToggle v-else-if="isToggle" :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" />
      <VueCanvasWidgetsWidgetText v-else-if="isText" :model-value="modelValue" :multiline="widgetDef.multiline ?? (widgetDef.name.toLowerCase().includes('text') || widgetDef.name.toLowerCase().includes('prompt'))" @update:model-value="emit('update:modelValue', $event)" />
    </template>
  </div>
</template>
