<script setup lang="ts">
import {
  X, Toolbox,
  // Tone
  Contrast, Sun, Activity, ChartColumn, SunMoon, CircleDot, Lightbulb,
  // Color
  SlidersHorizontal, Thermometer, Palette, Scale, Donut, Funnel, Paintbrush, Layers, RefreshCcw, Grid3x3, Eclipse,
  // Sharpen & noise
  Diamond, Sparkles, WandSparkles,
  // Blur
  Aperture,
  // Geometry
  Crop, Scaling, RotateCw, FlipHorizontal2,
  // Distortion
  Minimize2, RotateCcw, Waves, Focus,
  // Stylize
  Square, Mountain,
  // Composite
  Combine, Image, ImageOff, Pipette,
  // Shader-style: Lens, Stylize, Generative, Distortion, Grading, Atmosphere
  Camera, CircleDashed, MonitorPlay, Disc, Brush, Hash, GitCompare, Boxes, ArrowRightLeft,
  CornerLeftDown, Slice, Maximize, Droplet, Blend as BlendIcon, Flashlight, Lamp, Film,
  // Round 3
  Atom, Snowflake, BookOpen, Layers2, Microscope, Columns3,
  // Matte
  Expand as ExpandIcon, LayersPlus, Type as TypeIcon, MousePointerClick,
  // Unicorn batch
  Map as MapIcon, Cuboid, Spline, FlipHorizontal, Rainbow, Dot, Star, Sun as SunIcon, Wind,
  // Chrome & domain tabs
  Search as SearchIcon, ChevronDown,
  Image as ImageDomainIcon, AudioWaveform as AudioIcon, Video as VideoIcon, Box as BoxIcon,
  // Video effects
  Footprints, Wind as WindIcon2, RectangleHorizontal, Shuffle, Rewind, Scissors, MoveRight, Hourglass,
  GalleryHorizontal, FileVideo,
  // Video pro
  Gauge, ZoomIn, Frame, Sparkle, MessageSquare, Film as FilmIcon, Sliders, AudioLines, ArrowLeftRight, Anchor,
  // Audio
  Mic, FileAudio, Music, Volume2, VolumeX, Equal, SlidersVertical, Combine as CombineIcon, SunsetIcon,
  Sunrise as SunriseIcon, SplitSquareHorizontal, Merge as MergeIcon,
  // AI / face
  UserRoundCog, Loader2, CloudDownload,
  // SmartLayout (compose section)
  LayoutTemplate,
} from 'lucide-vue-next'
import { useNodeSearch } from '~/composables/useNodeSearch'

defineEmits<{ close: [] }>()

type Domain = 'image' | 'audio' | 'video' | '3d'
// Toolbox-visible id for a model bundle (declared server-side via
// _model_downloads.register_bundle). Add new keys here as we ship new ML nodes.
type ModelBundleKey = 'faceswap' | 'bgremove' | 'upscale' | 'frameinterp' | 'subjecttrack'

interface ToolboxItem {
  nodeType: string
  label: string
  description: string
  icon: any
  // When set, clicking the card kicks off a background download with a
  // progress toast BEFORE the node is added to the canvas. Drag is blocked
  // until the download is done.
  requiresModels?: ModelBundleKey
}
interface ToolboxSection { title: string; items: ToolboxItem[]; domain?: Domain }

// Domain accent colors match the homepage prompt-chip palette (pages/index.vue)
// so the same surface = the same hue across the app.
const DOMAINS: { id: Domain; label: string; icon: any; color: string }[] = [
  { id: 'image', label: 'Image', icon: ImageDomainIcon, color: '#96b4ff' },
  { id: 'audio', label: 'Audio', icon: AudioIcon,       color: '#ff99f7' },
  { id: 'video', label: 'Video', icon: VideoIcon,       color: '#54f4cf' },
  { id: '3d',    label: '3D',    icon: BoxIcon,         color: '#ffb984' },
]

// Section titles to default-collapse on first install (no localStorage entry yet).
// Keeps the panel short out of the box; user can expand what they need.
const DEFAULT_COLLAPSED = new Set<string>([
  'image:Distortion', 'image:Stylize', 'image:Lens', 'image:Painterly',
  'image:Generative', 'image:Warp', 'image:Grading', 'image:Atmosphere', 'image:Lab',
])

const rawSections: ToolboxSection[] = [
  {
    title: 'Tone',
    items: [
      { nodeType: 'AdjustBrightnessContrast', label: 'Brightness', description: 'Adjust overall brightness and contrast.', icon: Contrast },
      { nodeType: 'AdjustExposure', label: 'Exposure', description: 'Shift image exposure in stops (EV).', icon: Sun },
      { nodeType: 'AdjustCurves', label: 'Curves', description: 'Shape the tone curve with shadows, midtones, and highlights.', icon: Activity },
      { nodeType: 'AdjustLevels', label: 'Levels', description: 'Remap input tonal range with black point, gamma, and white point.', icon: ChartColumn },
      { nodeType: 'AdjustShadowsHighlights', label: 'Shadows / Highlights', description: 'Selectively lift shadows and recover highlights.', icon: SunMoon },
      { nodeType: 'AdjustVignette', label: 'Vignette', description: 'Darken or lighten image corners.', icon: CircleDot },
      { nodeType: 'AdjustGlow', label: 'Glow', description: 'Bright pixels bleed softly into surroundings (bloom).', icon: Lightbulb },
    ],
  },
  {
    title: 'Color',
    items: [
      { nodeType: 'AdjustColor', label: 'Hue / Sat / Lum', description: 'Shift hue, saturation, and lightness of an image.', icon: SlidersHorizontal },
      { nodeType: 'AdjustTemperature', label: 'Temperature', description: 'Shift white balance: warm/cool and green/magenta.', icon: Thermometer },
      { nodeType: 'AdjustVibrance', label: 'Vibrance', description: 'Saturate muted colors more than already-saturated ones.', icon: Palette },
      { nodeType: 'AdjustColorBalance', label: 'Color Balance', description: 'Shift color in shadows, midtones, and highlights independently.', icon: Scale },
      { nodeType: 'AdjustBlackWhite', label: 'Black & White', description: 'Convert to grayscale with adjustable color weights.', icon: Eclipse },
      { nodeType: 'AdjustPhotoFilter', label: 'Photo Filter', description: 'Overlay a color cast — warm, cool, sepia, and more.', icon: Funnel },
      { nodeType: 'AdjustGradientMap', label: 'Gradient Map', description: 'Remap luminance through a 2-stop color gradient.', icon: Paintbrush },
      { nodeType: 'AdjustChannelMixer', label: 'Channel Mixer', description: 'Recombine R/G/B channels with custom coefficients.', icon: Layers },
      { nodeType: 'AdjustInvert', label: 'Invert', description: 'Invert image colors.', icon: RefreshCcw },
      { nodeType: 'AdjustPosterize', label: 'Posterize', description: 'Reduce the number of color levels per channel.', icon: Grid3x3 },
      { nodeType: 'AdjustThreshold', label: 'Threshold', description: 'Convert to pure black/white based on luminance.', icon: Donut },
      { nodeType: 'PaletteQuantize', label: 'Quantize', description: 'Reduce the image to N colors via k-means clustering.', icon: Layers2 },
    ],
  },
  {
    title: 'Sharpen & Noise',
    items: [
      { nodeType: 'Sharpen', label: 'Sharpen', description: 'Unsharp mask with amount and radius.', icon: Diamond },
      { nodeType: 'AddNoise', label: 'Add Noise', description: 'Add gaussian or uniform noise.', icon: Sparkles },
      { nodeType: 'Denoise', label: 'Denoise', description: 'Smooth out noise with a gaussian filter.', icon: WandSparkles },
    ],
  },
  {
    title: 'Blur',
    items: [
      { nodeType: 'Blur', label: 'Blur', description: 'Gaussian, motion, or zoom blur — one node, three modes.', icon: Aperture },
    ],
  },
  {
    title: 'Geometry',
    items: [
      { nodeType: 'CropImage', label: 'Crop', description: 'Crop by trimming a fraction off each edge.', icon: Crop },
      { nodeType: 'ResizeImage', label: 'Resize', description: 'Scale the image by a uniform factor.', icon: Scaling },
      { nodeType: 'RotateImage', label: 'Rotate', description: 'Rotate the image around its center.', icon: RotateCw },
      { nodeType: 'FlipImage', label: 'Flip', description: 'Mirror horizontally and/or vertically.', icon: FlipHorizontal2 },
    ],
  },
  {
    title: 'Distortion',
    items: [
      { nodeType: 'Pinch', label: 'Pinch', description: 'Bulge or pinch the image around its center.', icon: Minimize2 },
      { nodeType: 'Twirl', label: 'Twirl', description: 'Rotate pixels around the center, proportional to distance.', icon: RotateCcw },
      { nodeType: 'Wave', label: 'Wave', description: 'Sinusoidal pixel displacement.', icon: Waves },
      { nodeType: 'LensCorrection', label: 'Lens', description: 'Barrel ↔ pincushion radial distortion.', icon: Focus },
      { nodeType: 'Mirror', label: 'Mirror', description: 'Mirror one half of the image onto the other, with quadrant modes.', icon: FlipHorizontal },
      { nodeType: 'FlowField', label: 'Flow Field', description: 'Warp the image along a smooth noise-driven flow field.', icon: Wind },
    ],
  },
  {
    title: 'Stylize',
    items: [
      { nodeType: 'Pixelate', label: 'Pixelate', description: 'Reduce the image to blocks of color.', icon: Grid3x3 },
      { nodeType: 'FindEdges', label: 'Find Edges', description: 'Highlight edges using a Sobel filter.', icon: Square },
      { nodeType: 'Outline', label: 'Outline', description: 'Detect edges and draw them over a solid fill or the source image.', icon: Spline },
      { nodeType: 'Emboss', label: 'Emboss', description: 'Render the image as a relief.', icon: Mountain },
      { nodeType: 'HighPass', label: 'High Pass', description: 'Keep the high-frequency residue after a gaussian blur.', icon: Funnel },
      { nodeType: 'HeightmapRelief', label: 'Relief', description: 'Light the image as if its luma were a heightmap.', icon: Mountain },
      { nodeType: 'Stipple', label: 'Stipple', description: 'Render the image as a field of randomly placed dots.', icon: Dot },
      { nodeType: 'Hologram', label: 'Hologram', description: 'Iridescent rainbow tint that shifts with brightness and position.', icon: Rainbow },
    ],
  },
  {
    title: 'Composite',
    items: [
      { nodeType: 'Blend', label: 'Blend', description: 'Combine two images with a blend mode and opacity.', icon: Combine },
      { nodeType: 'ApplyMask', label: 'Apply Mask', description: 'Multiply the image by a mask (white = keep, black = remove).', icon: Image },
      { nodeType: 'ThresholdMask', label: 'Threshold Mask', description: 'Build a mask from image luminance above a threshold.', icon: ImageOff },
      { nodeType: 'ColorRangeMask', label: 'Color Range', description: 'Build a mask from pixels matching a target color.', icon: Pipette },
      { nodeType: 'Compositor', label: 'Compositor', description: 'Stack up to 4 image layers with transform, opacity, and blend.', icon: Layers2 },
      { nodeType: 'SmartLayout', label: 'Smart Layout', description: 'Compose a layout visually and render it across one or more aspect ratios. Edit on the canvas via the “Edit layout” button.', icon: LayoutTemplate },
      { nodeType: 'Text', label: 'Text', description: 'Editable text passthrough. Wire an LLM (Claude / Gemini / Whisper) into it, view and tweak the value, send downstream into SmartLayout’s text_layers or anywhere else expecting a STRING.', icon: TypeIcon },
      { nodeType: 'MatteGrowShrink', label: 'Grow / Shrink', description: 'Dilate or erode a mask, with optional feathering.', icon: ExpandIcon },
      { nodeType: 'MergeAlpha', label: 'Merge Alpha', description: 'Combine an image with a mask into an RGBA image.', icon: LayersPlus },
      { nodeType: 'MaskByText', label: 'Mask by Text', description: 'Generate a mask from a text prompt describing the area (CLIPSeg).', icon: TypeIcon },
      { nodeType: 'MaskExtractor', label: 'Mask Extractor', description: 'Click on the preview to select the object at that point (SAM).', icon: MousePointerClick },
    ],
  },
  {
    title: 'Lens',
    items: [
      { nodeType: 'ChromaticAberration', label: 'Aberration', description: 'Offset color channels radially, simulating lens fringing.', icon: CircleDashed },
      { nodeType: 'Halftone', label: 'Halftone', description: 'Newspaper-print dot pattern.', icon: Hash },
      { nodeType: 'CRT', label: 'CRT / VHS', description: 'Scanlines, RGB stripe, chromatic offset, slight barrel.', icon: MonitorPlay },
      { nodeType: 'Bokeh', label: 'Bokeh', description: 'Disk-kernel defocus — highlights bloom as soft circles.', icon: Disc },
      { nodeType: 'TiltShift', label: 'Tilt-shift', description: 'Sharp horizontal band, heavy blur above and below — miniature look.', icon: Microscope },
      { nodeType: 'Blinds', label: 'Blinds', description: 'Venetian blinds — image visible through slats, dark between.', icon: Columns3 },
    ],
  },
  {
    title: 'Painterly',
    items: [
      { nodeType: 'Kuwahara', label: 'Kuwahara', description: 'Painterly oil-paint smoothing that preserves edges.', icon: Brush },
      { nodeType: 'CrossHatch', label: 'Cross-hatch', description: 'Pen-and-ink hatching that builds up in darker areas.', icon: GitCompare },
      { nodeType: 'Dither', label: 'Dither', description: 'Ordered Bayer dithering — reduces color count with a pattern.', icon: Boxes },
      { nodeType: 'Ascii', label: 'ASCII', description: 'Replace each cell of the image with a character chosen by brightness.', icon: Hash },
    ],
  },
  {
    title: 'Generative',
    items: [
      { nodeType: 'PerlinNoise', label: 'Perlin', description: 'Procedural fractal noise texture.', icon: Sparkles },
      { nodeType: 'Voronoi', label: 'Voronoi', description: 'Cellular pattern — each pixel takes the nearest random point.', icon: Boxes },
      { nodeType: 'GradientGenerator', label: 'Gradient', description: 'Generate a linear or radial gradient between two colors.', icon: Paintbrush },
      { nodeType: 'ReactionDiffusion', label: 'Reaction-Diffusion', description: 'Gray-Scott — spots, stripes, coral patterns grown from math.', icon: Atom },
      { nodeType: 'Fractal', label: 'Fractal', description: 'Mandelbrot or Julia set with zoom and palette.', icon: Snowflake },
    ],
  },
  {
    title: 'Warp',
    items: [
      { nodeType: 'Kaleidoscope', label: 'Kaleidoscope', description: 'Mirror the image into N angular segments.', icon: Maximize },
      { nodeType: 'PolarCoords', label: 'Polar', description: 'Wrap the image into a circle (rect → polar).', icon: ArrowRightLeft },
      { nodeType: 'Glitch', label: 'Glitch', description: 'Random horizontal slice shifts with per-channel offsets.', icon: Slice },
      { nodeType: 'Fisheye', label: 'Fisheye', description: 'Strong barrel distortion for a fisheye-lens look.', icon: Camera },
    ],
  },
  {
    title: 'Grading',
    items: [
      { nodeType: 'Duotone', label: 'Duotone', description: 'Map luminance to two colors — classic newsprint look.', icon: Droplet },
      { nodeType: 'SplitToning', label: 'Split Toning', description: 'Tint shadows and highlights with different colors.', icon: BlendIcon },
      { nodeType: 'GradientMap', label: 'Gradient Map', description: 'Map the image\'s luminance to a 2-color gradient.', icon: MapIcon },
      { nodeType: 'Posterize', label: 'Posterize', description: 'Reduce each channel to a small number of discrete levels.', icon: Cuboid },
    ],
  },
  {
    title: 'Atmosphere',
    items: [
      { nodeType: 'GodRays', label: 'God Rays', description: 'Radial light streaks from a center through bright pixels.', icon: Flashlight },
      { nodeType: 'LensFlare', label: 'Lens Flare', description: 'Procedural lens flare: halo, anamorphic streak, ghost circles.', icon: Sparkles },
      { nodeType: 'LightLeak', label: 'Light Leak', description: 'Colored gradient overlay simulating film light leaks.', icon: Lamp },
      { nodeType: 'FilmGrain', label: 'Film Grain', description: 'Anisotropic noise that peaks in the midtones.', icon: Film },
      { nodeType: 'Caustics', label: 'Caustics', description: 'Water-surface light dappling, screen-blended over the image.', icon: Waves },
      { nodeType: 'Sparkle', label: 'Sparkle', description: 'Place 4- or 8-point starbursts on bright spots.', icon: Star },
      { nodeType: 'TwoDLight', label: '2D Light', description: 'Overlay a soft directional light gradient on the image.', icon: SunIcon },
    ],
  },
  {
    title: 'Lab',
    items: [
      { nodeType: 'FrequencySeparation', label: 'Freq Sep', description: 'Split image into low (color) and high (detail) frequencies.', icon: BookOpen },
    ],
  },
  {
    title: 'AI',
    items: [
      { nodeType: 'FaceSwap', label: 'Face Swap', description: 'Replace a face in the target with the face from a reference photo. Downloads ~530 MB on first use.', icon: UserRoundCog, requiresModels: 'faceswap' },
      { nodeType: 'BackgroundRemove', label: 'Remove BG', description: 'Knock out the background and emit a clean alpha mask. Downloads ~179 MB on first use.', icon: Scissors, requiresModels: 'bgremove' },
      { nodeType: 'UpscaleImage', label: 'Upscale 2×', description: 'Real-ESRGAN 2× upscale. Doubles each dimension while sharpening detail. Downloads ~64 MB on first use.', icon: Maximize, requiresModels: 'upscale' },
    ],
  },

  // ---------- Audio domain ----------
  {
    domain: 'audio',
    title: 'Source',
    items: [
      { nodeType: 'LoadAudio',       label: 'Load Audio',     description: 'Load an audio file from disk.', icon: FileAudio },
      { nodeType: 'RecordAudio',     label: 'Record',         description: 'Capture audio from a microphone in the browser.', icon: Mic },
      { nodeType: 'EmptyAudio',      label: 'Empty / Silence', description: 'Generate silence of a given duration and channel count.', icon: VolumeX },
      { nodeType: 'PreviewAudio',    label: 'Preview',        description: 'Listen to an audio output in the panel.', icon: Volume2 },
      { nodeType: 'SaveAudio',       label: 'Save (FLAC)',    description: 'Save audio as a lossless FLAC file.', icon: Music },
      { nodeType: 'SaveAudioMP3',    label: 'Save (MP3)',     description: 'Save audio as an MP3 file.', icon: Music },
    ],
  },
  {
    domain: 'audio',
    title: 'Edit',
    items: [
      { nodeType: 'TrimAudioDuration', label: 'Trim',         description: 'Keep only a [start, end) range of the clip.', icon: Scissors },
      { nodeType: 'AudioConcat',     label: 'Concat',         description: 'Join two clips end-to-end.', icon: ArrowLeftRight },
      { nodeType: 'AudioMerge',      label: 'Mix',            description: 'Layer two clips on top of each other (add, mean, multiply, subtract).', icon: CombineIcon },
      { nodeType: 'AudioFade',       label: 'Fade',           description: 'Fade in at the head and/or fade out at the tail, with curve.', icon: SunsetIcon },
    ],
  },
  {
    domain: 'audio',
    title: 'Level',
    items: [
      { nodeType: 'AudioAdjustVolume', label: 'Volume',       description: 'Boost or attenuate the clip by a number of dB.', icon: SlidersVertical },
      { nodeType: 'AudioNormalize',  label: 'Normalize',      description: 'Scale to a target peak or RMS level in dBFS.', icon: Equal },
      { nodeType: 'AudioDuck',       label: 'Duck',           description: 'Sidechain ducking — lower one track while another is playing.', icon: SunriseIcon },
    ],
  },
  {
    domain: 'audio',
    title: 'EQ & Channels',
    items: [
      { nodeType: 'AudioEqualizer3Band', label: '3-Band EQ',  description: 'Low shelf + peaking mid + high shelf.', icon: SlidersHorizontal },
      { nodeType: 'SplitAudioChannels', label: 'Split Channels', description: 'Split a stereo (or N-channel) clip into per-channel mono clips.', icon: SplitSquareHorizontal },
      { nodeType: 'JoinAudioChannels',  label: 'Join Channels',  description: 'Combine mono clips into a multi-channel clip.', icon: MergeIcon },
    ],
  },
  {
    domain: 'audio',
    title: 'AI',
    items: [
      { nodeType: 'WhisperTranscribe', label: 'Transcribe',    description: 'Speech-to-text via Whisper. Outputs Caption Track text + SRT.', icon: MessageSquare },
      { nodeType: 'VocalSeparator',    label: 'Vocal Separator', description: 'Split a song into vocals + instrumental stems (Demucs).', icon: Mic },
      { nodeType: 'AudioDenoise',      label: 'Denoise',         description: 'Remove background noise (hiss, hum, room tone, fans) from a clip. No download required.', icon: VolumeX },
    ],
  },

  // ---------- Video domain ----------
  {
    domain: 'video',
    title: 'Source',
    items: [
      { nodeType: 'LoadVideoFrames',      label: 'Load Video',         description: 'Load a video file and output its frames directly as an image batch — plugs straight into the Timeline.', icon: FileVideo },
      { nodeType: 'SaveVideoFrames',      label: 'Save Video',         description: 'Encode an image batch to .mp4 with optional audio. The output-side counterpart to Load Video.', icon: FileVideo },
      { nodeType: 'TextClip',             label: 'Text Clip',          description: 'Render text as a clip you can drop into a Timeline layer.', icon: TypeIcon },
      { nodeType: 'AudioWaveform',        label: 'Audio Waveform',     description: 'Visualize audio as bars, waves, dots, or a radial spectrum — drop into the Timeline.', icon: AudioLines },
    ],
  },
  {
    domain: 'video',
    title: 'Temporal',
    items: [
      { nodeType: 'FrameTrail',           label: 'Frame Trail',        description: 'Blend previous frames with decaying intensity to create motion trails.', icon: Footprints },
      { nodeType: 'TemporalMotionBlur',   label: 'Motion Blur',        description: 'Average adjacent frames in a sliding window — real motion blur.', icon: WindIcon2 },
      { nodeType: 'SlitScan',             label: 'Slit Scan',          description: 'Each column reads from a different time — fast subjects smear horizontally.', icon: RectangleHorizontal },
      { nodeType: 'TimeDisplacement',     label: 'Time Displace',      description: 'Different regions sample from different points in time, driven by noise.', icon: Shuffle },
    ],
  },
  {
    domain: 'video',
    title: 'Edit',
    items: [
      { nodeType: 'VideoReverse',         label: 'Reverse',            description: 'Reverse the clip, or ping-pong it for a seamless loop.', icon: Rewind },
      { nodeType: 'VideoTrim',            label: 'Trim',               description: 'Keep only frames in a [start, end) range.', icon: Scissors },
      { nodeType: 'VideoCrossfade',       label: 'Crossfade',          description: 'Join two clips end-to-end with a smooth blend at the seam.', icon: MoveRight },
      { nodeType: 'Timeline',             label: 'Timeline',           description: 'Composite up to 4 clips on a timeline with per-clip start, transform, blend, and fades.', icon: GalleryHorizontal },
      { nodeType: 'SpeedRamp',            label: 'Speed Ramp',         description: 'Speed up or slow down a clip, with optional ease-in/out of the rate.', icon: Gauge },
      { nodeType: 'KenBurns',             label: 'Ken Burns',          description: 'Animated zoom + drift over a clip — the doc-edit punch-in move.', icon: ZoomIn },
      { nodeType: 'AspectConvert',        label: 'Aspect',             description: 'Reframe a clip to 9:16, 1:1, 16:9, etc. with crop, pad, or auto-pan.', icon: Frame },
      { nodeType: 'Transition',           label: 'Transition',         description: 'Join two clips with a stylized transition — dissolve, whip pan, zoom, glitch, light leak.', icon: ArrowLeftRight },
      { nodeType: 'Stabilize',            label: 'Stabilize',          description: 'Smooth out camera shake using 2D translation tracking.', icon: Anchor },
      { nodeType: 'VideoSilenceCut',      label: 'Silence Cut',        description: 'Auto-remove silent stretches, keeping frames + audio in sync.', icon: VolumeX },
      { nodeType: 'FrameInterpolate',     label: 'Slow Motion',        description: 'Synthesize in-between frames via optical flow — true slow-mo, not duplication.', icon: Hourglass },
    ],
  },
  {
    domain: 'video',
    title: 'Composite',
    items: [
      { nodeType: 'ChromaKey',            label: 'Chroma Key',         description: 'Knock out a key color (green/blue screen) and emit a soft mask.', icon: Sparkle },
      { nodeType: 'CaptionTrack',         label: 'Captions',           description: 'Burn timed captions onto a clip. One line per caption.', icon: MessageSquare },
    ],
  },
  {
    domain: 'video',
    title: 'Color',
    items: [
      { nodeType: 'LUT',                  label: 'LUT',                description: 'Apply a 3D .cube LUT — cinematic color grading from any LUT pack.', icon: FilmIcon },
      { nodeType: 'ThreeWayCC',           label: '3-Way Color',        description: 'Lift / Gamma / Gain across shadows, mids, and highlights.', icon: Sliders },
    ],
  },
  {
    domain: 'video',
    title: 'Generate',
    items: [
      { nodeType: 'AnimatedNoise',        label: 'Animated Noise',     description: 'Generate a clip of evolving value noise — pans, breathes, or swirls.', icon: Hourglass },
    ],
  },
]

// Apply default domain to any section that didn't set one explicitly.
const sections = computed<Required<ToolboxSection>[]>(() =>
  rawSections.map(s => ({ ...s, domain: s.domain ?? 'image' })),
)

const activeDomain = ref<Domain>('image')
const searchQuery = ref('')

function domainItemCount(d: Domain): number {
  return sections.value
    .filter(s => s.domain === d)
    .reduce((sum, s) => sum + s.items.length, 0)
}

// Visible sections = current domain + (if searching) filtered items per section.
const visibleSections = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return sections.value
    .filter(s => s.domain === activeDomain.value)
    .map(s => {
      if (!q) return s
      const items = s.items.filter(it =>
        it.label.toLowerCase().includes(q)
        || it.description.toLowerCase().includes(q)
        || it.nodeType.toLowerCase().includes(q),
      )
      return { ...s, items }
    })
    .filter(s => s.items.length > 0)
})

// Collapsed sections, persisted to localStorage.
const STORAGE_KEY = 'toolbox.collapsedSections'
const collapsedKeys = ref<Set<string>>(new Set())

function loadCollapsed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw != null) {
      collapsedKeys.value = new Set(JSON.parse(raw))
    } else {
      // First load: apply our default-collapsed set.
      collapsedKeys.value = new Set(DEFAULT_COLLAPSED)
    }
  } catch {
    collapsedKeys.value = new Set(DEFAULT_COLLAPSED)
  }
}
function saveCollapsed() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsedKeys.value]))
  } catch {}
}
onMounted(loadCollapsed)

function sectionKey(s: { domain: Domain; title: string }): string {
  return `${s.domain}:${s.title}`
}
function isCollapsed(s: { domain: Domain; title: string }): boolean {
  // While searching, force-expand every section so matches are visible.
  if (searchQuery.value.trim()) return false
  return collapsedKeys.value.has(sectionKey(s))
}
function toggleSection(s: { domain: Domain; title: string }) {
  const key = sectionKey(s)
  const next = new Set(collapsedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedKeys.value = next
  saveCollapsed()
}

const { addNode } = useNodeSearch()

// -- Model pre-download orchestration ---------------------------------------
// Some nodes (FaceSwap) need hundreds of MB of weights. We pre-fetch when the
// card is first clicked so the first prompt isn't a "why is this hanging" moment.

interface DownloadState {
  active: boolean
  label: string                      // "Face Swap" — what's installing
  file: string                       // current file being fetched
  downloaded: number                 // bytes
  total: number                      // bytes
  phase: 'checking' | 'downloading' | 'preparing' | 'error'
  message?: string                   // populated on error
}
const download = reactive<DownloadState>({
  active: false, label: '', file: '', downloaded: 0, total: 0, phase: 'checking',
})

// Per-key in-flight promise so repeated clicks dedupe to a single download.
const inflight = new Map<string, Promise<boolean>>()

// Which model bundles are already on disk — drives the cloud-icon badge on
// cards. Probed on mount and after each successful download.
const modelsReady = reactive<Set<string>>(new Set())

async function probeModelStatus(key: ModelBundleKey) {
  try {
    const status = await (await fetch(`/comfynext/models/status?key=${key}`)).json()
    if (status.ready) modelsReady.add(key)
    else modelsReady.delete(key)
  } catch { /* offline — leave as not-ready; click will surface the error */ }
}
const ALL_BUNDLES: ModelBundleKey[] = ['faceswap', 'bgremove', 'upscale', 'frameinterp', 'subjecttrack']
onMounted(() => { for (const k of ALL_BUNDLES) probeModelStatus(k) })

// Card-level helpers used by the template.
function isModelMissing(item: ToolboxItem): boolean {
  return !!item.requiresModels && !modelsReady.has(item.requiresModels)
}
function isCardDownloading(item: ToolboxItem): boolean {
  return !!item.requiresModels && download.active && inflight.has(item.requiresModels)
}
function cardProgress(): number {
  if (!download.total) return 0
  return download.downloaded / download.total
}

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0)
}

async function ensureModels(key: ModelBundleKey): Promise<boolean> {
  if (inflight.has(key)) return inflight.get(key)!
  const p = (async (): Promise<boolean> => {
    download.active = true
    download.label = key  // overwritten by `start` event with the bundle's pretty label
    download.phase = 'checking'
    download.file = ''
    download.downloaded = 0
    download.total = 0
    download.message = undefined

    let status: any
    try {
      status = await (await fetch(`/comfynext/models/status?key=${key}`)).json()
      if (status.label) download.label = status.label
      if (status.ready) {
        download.active = false
        return true
      }
    } catch (err) {
      download.phase = 'error'
      download.message = 'Could not reach the model server. Is ComfyUI running?'
      return false
    }

    // SSE stream of `data: {json}\n\n` lines from /comfynext/models/download.
    return new Promise<boolean>((resolve) => {
      const es = new EventSource(`/comfynext/models/download?key=${key}`)
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.phase === 'start' && msg.label) {
            download.label = msg.label
          } else if (msg.phase === 'downloading') {
            download.phase = 'downloading'
            download.file = msg.file
            download.downloaded = msg.downloaded
            download.total = msg.total
          } else if (msg.phase === 'preparing') {
            download.phase = 'preparing'
            download.file = msg.file
          } else if (msg.phase === 'done') {
            download.active = false
            modelsReady.add(key)
            es.close()
            resolve(true)
          } else if (msg.phase === 'error') {
            download.phase = 'error'
            download.message = msg.message || 'Download failed.'
            es.close()
            resolve(false)
          }
        } catch {}
      }
      es.onerror = () => {
        // Browser closes EventSource on the stream's final byte — only flag a real
        // error if we never reached `done`.
        if (download.active && download.phase !== 'error') {
          download.phase = 'error'
          download.message = 'Lost connection to the model server.'
        }
        es.close()
        resolve(download.phase !== 'error')
      }
    })
  })().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

function dismissDownload() {
  download.active = false
}

async function handleAdd(item: ToolboxItem) {
  if (item.requiresModels) {
    const ok = await ensureModels(item.requiresModels)
    if (!ok) return  // toast already shows the error; user can retry by clicking again
  }
  addNode(item.nodeType)
}

const panelRef = ref<HTMLDivElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const hoveredItem = ref<ToolboxItem | null>(null)
const hoverPos = ref({ top: 0, left: 0 })
let enterTimer: ReturnType<typeof setTimeout> | null = null

function clearSearch() {
  searchQuery.value = ''
  searchInputRef.value?.focus()
}

// Native HTML5 drag → drop onto the VueFlow canvas. VueNodeCanvas already
// listens for `dragover`/`drop` and creates the node at the cursor position.
function onCardDragStart(event: DragEvent, item: ToolboxItem) {
  if (!event.dataTransfer) return
  // Nodes that need weights downloaded can't be dragged onto the canvas (the
  // canvas drop handler would try to instantiate immediately). Cancel the drag
  // and kick off the download instead — the user can drag once it's installed.
  if (item.requiresModels) {
    event.preventDefault()
    handleAdd(item)
    return
  }
  event.dataTransfer.setData('text/plain', item.nodeType)
  event.dataTransfer.effectAllowed = 'copy'
  // Hide the hover-preview tooltip while a drag is in flight.
  if (enterTimer) clearTimeout(enterTimer)
  hoveredItem.value = null
}

function onCardEnter(event: MouseEvent, item: ToolboxItem) {
  const cardRect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const panelRect = panelRef.value?.getBoundingClientRect()
  if (enterTimer) clearTimeout(enterTimer)
  // Tiny delay so quick mouse-overs don't flash a preview.
  enterTimer = setTimeout(() => {
    hoveredItem.value = item
    hoverPos.value = {
      top: cardRect.top + cardRect.height / 2,
      left: (panelRect?.right ?? cardRect.right) + 8,
    }
  }, 120)
}
function onCardLeave() {
  if (enterTimer) clearTimeout(enterTimer)
  hoveredItem.value = null
}
</script>

<template>
  <div ref="panelRef" class="h-full bg-[#1a1a1a]/95 backdrop-blur-md border-r border-white/10 flex flex-col shadow-2xl">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <div class="flex items-center gap-2">
        <Toolbox class="size-4 text-white/70" />
        <span class="text-sm font-semibold text-white/90">Toolbox</span>
      </div>
      <button
        class="flex items-center justify-center size-6 rounded hover:bg-white/10 transition-colors cursor-pointer"
        @click="$emit('close')"
      >
        <X class="size-4 text-white/60" />
      </button>
    </div>

    <!-- Search input -->
    <div class="px-3 pt-3 pb-2">
      <div class="relative">
        <SearchIcon class="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-white/40 pointer-events-none" />
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          placeholder="Search the toolbox…"
          class="w-full bg-white/[0.04] border border-white/10 rounded pl-7 pr-7 py-1.5 text-xs text-white/85 placeholder-white/30 outline-none focus:bg-white/[0.06] focus:border-white/20 transition-colors"
          @keydown.esc="clearSearch"
        />
        <button
          v-if="searchQuery"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 size-4 rounded hover:bg-white/10 flex items-center justify-center cursor-pointer"
          title="Clear search"
          @click="clearSearch"
        >
          <X class="size-3 text-white/50" />
        </button>
      </div>
    </div>

    <!-- Domain tabs -->
    <div class="px-2 pb-2 flex gap-1">
      <button
        v-for="d in DOMAINS"
        :key="d.id"
        class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        :class="activeDomain === d.id
          ? 'font-medium'
          : 'text-white/55 hover:bg-white/[0.04] hover:text-white/85'"
        :style="activeDomain === d.id
          ? { backgroundColor: `${d.color}26`, color: d.color }
          : undefined"
        :disabled="domainItemCount(d.id) === 0 && activeDomain !== d.id"
        :title="d.label"
        @click="activeDomain = d.id"
      >
        <component :is="d.icon" class="size-3.5" :stroke-width="1.75" />
        <span>{{ d.label }}</span>
      </button>
    </div>

    <!-- Sections / empty state -->
    <div class="flex-1 overflow-y-auto pb-3">
      <div
        v-if="visibleSections.length === 0"
        class="px-4 py-12 text-center text-xs text-white/40"
      >
        <template v-if="searchQuery.trim()">
          No nodes match <span class="text-white/70">"{{ searchQuery }}"</span>.
          <button class="block mx-auto mt-2 text-white/70 hover:text-white underline underline-offset-2 cursor-pointer" @click="clearSearch">
            Clear search
          </button>
        </template>
        <template v-else>
          No tools in this category yet.
        </template>
      </div>

      <div v-for="section in visibleSections" :key="sectionKey(section)" class="px-2 pt-2">
        <button
          class="w-full flex items-center justify-between px-1 pb-1.5 group cursor-pointer"
          @click="toggleSection(section)"
        >
          <span class="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40 group-hover:text-white/65 transition-colors">
            {{ section.title }}
            <span class="ml-1 text-white/25 normal-case tracking-normal">{{ section.items.length }}</span>
          </span>
          <ChevronDown
            class="size-3 text-white/30 group-hover:text-white/55 transition-all"
            :class="isCollapsed(section) ? '-rotate-90' : ''"
          />
        </button>
        <div v-if="!isCollapsed(section)" class="grid grid-cols-3 gap-1">
          <button
            v-for="item in section.items"
            :key="item.nodeType"
            draggable="true"
            class="relative group flex flex-col items-center justify-center gap-2.5 aspect-square rounded-md bg-white/[0.025] hover:bg-white/[0.08] border border-white/[0.04] hover:border-white/10 transition-colors cursor-grab active:cursor-grabbing p-2"
            :title="isModelMissing(item) ? 'Click to download model weights, then add' : 'Click to add, or drag onto the canvas'"
            @click="handleAdd(item)"
            @dragstart="(e) => onCardDragStart(e, item)"
            @mouseenter="(e) => onCardEnter(e, item)"
            @mouseleave="onCardLeave"
          >
            <!-- Cloud badge: weights not yet on disk. Hidden once downloaded
                 (or while a download is in progress — the ring around the icon
                 carries the state at that point). -->
            <CloudDownload
              v-if="isModelMissing(item) && !isCardDownloading(item)"
              class="absolute top-1 right-1 size-3 text-white/40 group-hover:text-white/70 transition-colors"
              :stroke-width="1.75"
            />

            <!-- Icon + optional progress ring -->
            <div class="relative size-6 flex items-center justify-center">
              <!-- SVG ring: stroke-dashoffset gives us the partial arc. -->
              <svg
                v-if="isCardDownloading(item)"
                class="absolute inset-0 size-full -rotate-90"
                viewBox="0 0 36 36"
              >
                <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2.5" />
                <circle
                  cx="18" cy="18" r="16" fill="none"
                  stroke="#96b4ff" stroke-width="2.5" stroke-linecap="round"
                  :stroke-dasharray="2 * Math.PI * 16"
                  :stroke-dashoffset="2 * Math.PI * 16 * (1 - cardProgress())"
                  class="transition-[stroke-dashoffset] duration-200 ease-linear"
                />
              </svg>
              <component
                :is="item.icon"
                class="size-6 text-white/65 group-hover:text-white/95 transition-colors"
                :stroke-width="1.5"
              />
            </div>
            <span class="text-[11px] text-white/65 group-hover:text-white/90 text-center leading-tight transition-colors line-clamp-2">{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-150 ease-out"
      enter-from-class="opacity-0 -translate-x-1"
      enter-to-class="opacity-100 translate-x-0"
      leave-active-class="transition-opacity duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="hoveredItem"
        class="fixed z-[60] w-64 bg-[#1f1f1f]/95 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl p-3 pointer-events-none"
        :style="{ top: hoverPos.top + 'px', left: hoverPos.left + 'px', transform: 'translateY(-50%)' }"
      >
        <div class="flex items-center gap-2 mb-1.5">
          <div class="flex items-center justify-center size-7 rounded-md bg-white/5">
            <component :is="hoveredItem.icon" class="size-3.5 text-white/80" />
          </div>
          <span class="text-sm font-semibold text-white/90">{{ hoveredItem.label }}</span>
        </div>
        <p class="text-xs text-white/60 leading-relaxed">{{ hoveredItem.description }}</p>
      </div>
    </Transition>
  </Teleport>

  <!-- Model download toast: sticky bottom-right, shows progress for nodes that
       need weights (FaceSwap, etc.) before they can be added. -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="download.active"
        class="fixed bottom-6 right-6 z-[70] w-80 rounded-lg border border-white/10 bg-[#1a1a1a]/95 backdrop-blur-md shadow-2xl p-4"
      >
        <div class="flex items-center gap-2 mb-2">
          <Loader2 v-if="download.phase !== 'error'" class="size-4 text-white/70 animate-spin" />
          <X v-else class="size-4 text-rose-400" @click="dismissDownload" />
          <span class="text-sm font-medium text-white/90">
            Installing {{ download.label }}
          </span>
        </div>
        <p v-if="download.phase === 'checking'" class="text-xs text-white/55">
          Checking what's already downloaded…
        </p>
        <p v-else-if="download.phase === 'preparing'" class="text-xs text-white/55">
          Loading {{ download.file }}…
        </p>
        <p v-else-if="download.phase === 'error'" class="text-xs text-rose-400/90">
          {{ download.message }}
        </p>
        <template v-else>
          <div class="flex items-center justify-between text-[11px] text-white/55 mb-1.5 tabular-nums">
            <span class="truncate">{{ download.file }}</span>
            <span>{{ fmtMB(download.downloaded) }} / {{ fmtMB(download.total) }} MB</span>
          </div>
          <div class="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              class="h-full bg-[#96b4ff] transition-[width] duration-200 ease-linear"
              :style="{ width: download.total ? `${(download.downloaded / download.total * 100).toFixed(1)}%` : '5%' }"
            />
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>
