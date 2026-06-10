/**
 * Capability map for the "Get Started" modal: which generator can take
 * which kind of input and produce which kind of output.
 *
 * `from` = what the node needs to consume:
 *   - 'prompt' means "the user types text into the prompt widget, no
 *      upstream asset required" (covers most pure generators: Flux,
 *      Ideogram, MusicGen, …).
 *   - 'image' / 'video' / 'audio' / 'text' means an upstream artifact of
 *      that type — the modal pre-wires an artifact source card.
 *
 * `to` = what the node produces.
 *
 * Nodes that genuinely support multiple input modes (e.g. Generate Video
 * works prompt-only OR image-to-video) appear twice — once per mode —
 * because the post-selection canvas wiring is different.
 */

export type IOType = 'prompt' | 'image' | 'video' | 'audio' | 'text' | '3d'

export interface Capability {
  nodeType: string
  /** Use-case label shown to the user, e.g. "Generate an image". */
  useCase: string
  /** Model name shown under the use-case, e.g. "Flux Pro / Ideogram". */
  model: string
  from: IOType
  to: IOType
}

export const CAPABILITIES: Capability[] = [
  // ---------- Image · generation (prompt-only) ----------
  { nodeType: 'GenerateImageNode',  useCase: 'Generate an image',           model: 'Flux Pro / Ideogram',         from: 'prompt', to: 'image' },
  { nodeType: 'FluxLoRARemoteNode', useCase: 'Generate with your LoRA',     model: 'Flux Dev + LoRA',             from: 'prompt', to: 'image' },
  { nodeType: 'GenerateAnimeNode',  useCase: 'Generate an anime image',    model: 'Animagine XL',                 from: 'prompt', to: 'image' },
  { nodeType: 'GenerateEmojiNode',  useCase: 'Generate an emoji',           model: 'Flux Kontext + Emoji LoRA',   from: 'prompt', to: 'image' },

  // ---------- Image · from an image ----------
  { nodeType: 'EditImageNode',         useCase: 'Edit an image',           model: 'Flux Kontext Pro',             from: 'image', to: 'image' },
  { nodeType: 'BlendSceneNode',        useCase: 'Blend a composite scene',  model: 'Flux Kontext / Nano Banana',   from: 'image', to: 'image' },
  { nodeType: 'RestyleFromImageNode',  useCase: 'Restyle from an image',    model: 'Nano Banana / IP-Adapter',     from: 'image', to: 'image' },
  { nodeType: 'ProductShotNode',       useCase: 'Make a product shot',      model: 'SDXL Ad-Inpaint',              from: 'image', to: 'image' },
  { nodeType: 'UpscaleImageNode',      useCase: 'Upscale an image',        model: 'Clarity',                      from: 'image', to: 'image' },
  { nodeType: 'RemoveBackgroundNode',  useCase: 'Remove background',       model: '851-labs/bg-remover',          from: 'image', to: 'image' },
  { nodeType: 'RestorePhotoNode',      useCase: 'Restore an old photo',    model: 'Flux Kontext · Restore',       from: 'image', to: 'image' },
  { nodeType: 'FixFacesNode',          useCase: 'Fix faces in a photo',    model: 'CodeFormer',                   from: 'image', to: 'image' },
  { nodeType: 'LayerizeGraphicNode',   useCase: 'Layerize a graphic',      model: 'Ideogram Layerize',            from: 'image', to: 'image' },
  { nodeType: 'SplitPhotoLayersNode',  useCase: 'Split photo into layers', model: 'BG Remover + LaMa / Bria Eraser', from: 'image', to: 'image' },
  { nodeType: 'OutpaintImageNode',     useCase: 'Expand / outpaint an image', model: 'Flux Fill / Bria Expand',     from: 'image', to: 'image' },
  { nodeType: 'ConsistentFaceNode',    useCase: 'Generate a consistent face', model: 'Ideogram Character',        from: 'image', to: 'image' },
  { nodeType: 'SketchToImageNode',     useCase: 'Sketch to image',         model: 'Nano Banana',                  from: 'image', to: 'image' },

  // ---------- Text · from an image ----------
  { nodeType: 'DescribeImageNode', useCase: 'Describe an image',         model: 'Moondream 2',                    from: 'image', to: 'text' },
  { nodeType: 'ExtractTextNode',   useCase: 'Extract text from image',   model: 'ByteDance Dolphin (OCR)',        from: 'image', to: 'text' },
  { nodeType: 'FindObjectsNode',   useCase: 'Find objects in an image',  model: 'YOLO-World',                      from: 'image', to: 'text' },

  // ---------- Video · generation ----------
  { nodeType: 'GenerateVideoNode', useCase: 'Generate a video',           model: 'Seedance / Veo 3 / Kling',      from: 'prompt', to: 'video' },
  { nodeType: 'GenerateVideoNode', useCase: 'Animate an image into video', model: 'Seedance / Veo 3 / Kling',     from: 'image',  to: 'video' },
  { nodeType: 'FilmShotNode',      useCase: 'Film a cinematic shot',      model: 'Kling / full gallery',          from: 'prompt', to: 'video' },
  { nodeType: 'FilmShotNode',      useCase: 'Film a shot from an image',  model: 'Kling / full gallery',          from: 'image',  to: 'video' },

  // ---------- Video · from a video ----------
  { nodeType: 'EnhanceVideoNode',  useCase: 'Enhance a video',           model: 'Topaz',                          from: 'video', to: 'video' },
  { nodeType: 'LipsyncNode',       useCase: 'Sync lips to audio',        model: 'sync.so 2-pro',                  from: 'video', to: 'video' },
  { nodeType: 'DescribeVideoNode', useCase: 'Describe a video',          model: 'Gemini 2.5 Flash',               from: 'video', to: 'text' },

  // ---------- Audio · generation ----------
  { nodeType: 'GenerateMusicNode',   useCase: 'Generate music',           model: 'MusicGen',                      from: 'prompt', to: 'audio' },
  { nodeType: 'GenerateSpeechNode',  useCase: 'Generate speech',          model: 'MiniMax Speech-02 HD',          from: 'prompt', to: 'audio' },

  // ---------- Audio · from audio ----------
  { nodeType: 'TranscribeAudioNode',   useCase: 'Transcribe audio',        model: 'Whisper',                      from: 'audio', to: 'text' },
  { nodeType: 'IdentifySpeakersNode',  useCase: 'Identify speakers',       model: 'Whisper Diarization',          from: 'audio', to: 'text' },
  { nodeType: 'CloneSingingVoiceNode', useCase: 'Clone a singing voice',   model: 'RVC',                          from: 'audio', to: 'audio' },

  // ---------- 3D ----------
  { nodeType: 'Generate3DNode', useCase: 'Generate a 3D model',          model: 'Hunyuan3D 2',                    from: 'prompt', to: '3d' },
  { nodeType: 'Generate3DNode', useCase: 'Turn an image into a 3D model', model: 'Hunyuan3D 2',                    from: 'image',  to: '3d' },

  // ---------- Text · text in, text out ----------
  { nodeType: 'ChatLLMNode',           useCase: 'Chat with an LLM',          model: 'GPT-5 / Claude / Gemini',  from: 'prompt', to: 'text' },
  { nodeType: 'ImprovePromptNode',     useCase: 'Improve a prompt',          model: 'GPT-5 nano',               from: 'prompt', to: 'text' },
  { nodeType: 'SummarizeTextNode',     useCase: 'Summarize text',            model: 'Gemini 3 Flash',           from: 'text',   to: 'text' },
  { nodeType: 'TranslateTextNode',     useCase: 'Translate text',            model: 'Gemini 3 Flash',           from: 'text',   to: 'text' },
  { nodeType: 'RewriteToneNode',       useCase: 'Rewrite in a tone',         model: 'Claude 4.5 Haiku',         from: 'text',   to: 'text' },
  { nodeType: 'BrainstormIdeasNode',   useCase: 'Brainstorm ideas',          model: 'GPT-5 mini',               from: 'prompt', to: 'text' },
  { nodeType: 'ReasonStepByStepNode',  useCase: 'Think step by step',        model: 'DeepSeek R1',              from: 'prompt', to: 'text' },
]

export const OUTPUT_TYPES: { id: Exclude<IOType, 'prompt'>; label: string }[] = [
  { id: 'image', label: 'an image' },
  { id: 'video', label: 'a video' },
  { id: 'audio', label: 'audio' },
  { id: 'text',  label: 'text' },
  { id: '3d',    label: 'a 3D model' },
]

export const INPUT_TYPES: { id: IOType; label: string }[] = [
  { id: 'prompt', label: 'a prompt' },
  { id: 'image',  label: 'an image' },
  { id: 'video',  label: 'a video' },
  { id: 'audio',  label: 'an audio file' },
  { id: 'text',   label: 'text' },
]

/** Which input types are reachable for a given output. */
export function inputsFor(to: IOType): IOType[] {
  const set = new Set<IOType>()
  for (const c of CAPABILITIES) {
    if (c.to === to) set.add(c.from)
  }
  return [...set]
}

/** Which capabilities match a (from, to) pair. */
export function capabilitiesFor(from: IOType, to: IOType): Capability[] {
  return CAPABILITIES.filter((c) => c.from === from && c.to === to)
}

/** Map from artifact-bearing IO type → unified artifact node type that
 *  serves as the source on the canvas (when from ≠ 'prompt'). */
export const ARTIFACT_NODE_FOR_INPUT: Partial<Record<IOType, string>> = {
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  text:  'Text',
}
