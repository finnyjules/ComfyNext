/**
 * Agent capability registry — the curated knowledge of WHAT THE APP CAN DO, above
 * the raw ComfyUI node level. The canvas agent's palette is otherwise built only
 * from /object_info, which (a) gives raw nodes no intent vocabulary and (b) can't
 * see the frontend-only STUDIOS at all (they have no /object_info entry). This
 * registry fixes both: it lists the studios + the user-facing generators with rich
 * natural-language intents, so they surface for oblique phrasings and rank ABOVE
 * raw nodes for creative requests.
 *
 * It feeds three things into the existing matcher (lib/nodeMatch + portIntentCatalog):
 *   - capabilityKeywords(): nodeType → intent phrases (matched as keywords)
 *   - capabilityBoosts():   nodeType → small additive rank bonus
 *   - studioNodeTypes():    NodeTypeLite entries for the frontend studios, so
 *                           buildCatalog can include + wire them despite no /object_info
 *
 * See docs/agent-capabilities.md. Tested exhaustively in
 * tests/unit/agent-capability-routing.unit.spec.ts (phrasing → expected capability).
 */
import type { NodeTypeLite } from '~/lib/portIntent'
import type { CatalogEntry } from '~/lib/portIntentCatalog'

export type CapabilityKind = 'studio' | 'generator' | 'effect'

export interface AgentCapability {
  /** The nodeType the agent emits in addNode (a real /object_info class for
   *  generators/effects; a frontend node type for studios). */
  nodeType: string
  kind: CapabilityKind
  /** Human title (display name). */
  title: string
  /** One-line plain description (also fed to the matcher's description field). */
  summary: string
  /** Rich natural-language phrases/synonyms a user might say to request this.
   *  THE most important field — the agent's recall depends on it. */
  intents: string[]
  /** Link ports the agent can wire. `optional` inputs don't read as "required" in
   *  verify (e.g. a generator's img2img image). */
  inputs: { name: string; type: string; optional?: boolean }[]
  outputs: { name: string; type: string }[]
  /** Studios are frontend-only (no /object_info) → synthesize a NodeTypeLite +
   *  catalog entry so buildCatalog can include them. */
  frontendOnly?: boolean
  /** Additive rank bonus (kept small per nodeMatch's contract). Defaults by kind. */
  boost?: number
  /** Raw /object_info node ids this capability REPLACES — hidden from the agent
   *  palette so it never picks a redundant provider node (e.g. WaveSpeed/Magnific
   *  upscalers) over this curated dispatcher. */
  supersedes?: string[]
}

/** Default rank bonus by kind — studios + generators edge out raw nodes on ties
 *  for creative intents (kept small so a genuinely stronger match still wins). */
const DEFAULT_BOOST: Record<CapabilityKind, number> = { studio: 3, generator: 2.5, effect: 2 }

export function capabilityBoost(c: AgentCapability): number {
  return c.boost ?? DEFAULT_BOOST[c.kind]
}

/** The set of nodeTypes that are OUR curated capabilities (vs raw /object_info
 *  nodes) — used to mark + prioritise them in the agent palette. */
export function capabilityNodeTypes(caps: AgentCapability[] = AGENT_CAPABILITIES): Set<string> {
  return new Set(caps.map(c => c.nodeType))
}

/** Raw node ids that a capability replaces — excluded from the agent palette so a
 *  redundant provider node can't be picked over the curated dispatcher. */
export function supersededNodeTypes(caps: AgentCapability[] = AGENT_CAPABILITIES): Set<string> {
  const out = new Set<string>()
  for (const c of caps) for (const n of c.supersedes ?? []) out.add(n)
  return out
}

/** nodeType → intent phrases, for searchNodes/buildCatalog `keywords`. */
export function capabilityKeywords(caps: AgentCapability[] = AGENT_CAPABILITIES): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const c of caps) out[c.nodeType] = c.intents
  return out
}

/** nodeType → additive boost, for searchNodes/buildCatalog `boosts`. */
export function capabilityBoosts(caps: AgentCapability[] = AGENT_CAPABILITIES): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of caps) out[c.nodeType] = capabilityBoost(c)
  return out
}

/** NodeTypeLite entries for the frontend-only studios (no /object_info), so the
 *  matcher + buildCatalog can rank and include them. Generators already come from
 *  /object_info, so they're excluded here to avoid duplicate entries. */
export function studioNodeTypes(caps: AgentCapability[] = AGENT_CAPABILITIES): NodeTypeLite[] {
  return caps.filter(c => c.frontendOnly).map(c => ({
    name: c.nodeType,
    displayName: c.title,
    description: c.summary,
    category: c.kind,
    inputs: c.inputs,
    outputs: c.outputs,
  }))
}

/** Catalog entries for frontend studios (buildCatalog can't derive ports from a
 *  missing /object_info entry, so provide them). */
export function studioCatalogEntries(caps: AgentCapability[] = AGENT_CAPABILITIES): CatalogEntry[] {
  return caps.filter(c => c.frontendOnly).map(c => ({
    type: c.nodeType,
    name: c.title,
    description: c.summary,
    inputs: c.inputs,
    outputs: c.outputs,
    widgets: [],
  }))
}

export function capabilityByType(nodeType: string, caps: AgentCapability[] = AGENT_CAPABILITIES): AgentCapability | undefined {
  return caps.find(c => c.nodeType === nodeType)
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATORS — the user-facing creative nodes (Replicate-backed). nodeType ==
// the registered /object_info node_id. `effect` = an edit/restore/analysis op;
// `generator` = makes new media from a prompt/seed. Image-typed I/O lets the
// agent wire them; prompt-only nodes have no inputs.
// ─────────────────────────────────────────────────────────────────────────────
const IMG = [{ name: 'IMAGE', type: 'IMAGE' }]
const GENERATORS: AgentCapability[] = [
  // ---- Image · generation ----
  { nodeType: 'GenerateImageNode', kind: 'generator', title: 'Generate an image', summary: 'Text-to-image; pick any model (Flux, Ideogram, Reve…) and generate from a prompt.', inputs: [], outputs: IMG,
    intents: ['generate an image', 'make a picture', 'create an image', 'text to image', 'draw me', 'render a photo', 'make art', 'generate a photo of', 'imagine', 'dream up', 'conjure an image', 'produce an image', 'ai image', 'picture of a', 'visualize', 'make me a graphic', 'generate a dog', 'create artwork', 'create a painting of', 'render an illustration', 'wallpaper of a', 'make a wallpaper of', 'background image of'] },
  { nodeType: 'FluxLoRARemoteNode', kind: 'generator', title: 'Generate with your LoRA', summary: 'Generate with a trained LoRA (character/style), or img2img-restyle with it.', inputs: [{ name: 'image', type: 'IMAGE', optional: true }], outputs: IMG,
    intents: ['generate with my lora', 'use my trained model', 'make an image of my character', 'generate my character', 'use my finetune', 'lora generation', 'my model image', 'personalized generation', 'generate using my training', 'generate in my style', 'make this in my style', 'an image in my own style', 'use my trained style', 'my character in a scene'] },
  { nodeType: 'FluxMultiLoRARemoteNode', kind: 'generator', title: 'Generate with two LoRAs', summary: 'Stack two LoRAs (character + style) in one Flux generation.', inputs: [{ name: 'image', type: 'IMAGE', optional: true }], outputs: IMG,
    intents: ['combine two loras', 'my character in a style', 'stack loras', 'character plus style', 'use two trained models', 'mix loras', 'apply character and style lora', 'my character in watercolor style'] },
  { nodeType: 'GenerateAnimeNode', kind: 'generator', title: 'Generate an anime image', summary: 'Anime-style image generation (Animagine XL).', inputs: [], outputs: IMG,
    intents: ['make an anime image', 'anime art', 'generate manga style', 'draw anime', 'anime character', 'waifu', 'anime girl', 'manga drawing', 'make it anime', 'anime portrait'] },
  { nodeType: 'GenerateEmojiNode', kind: 'generator', title: 'Generate an emoji', summary: 'Turn a portrait into an iOS-style emoji (Flux Kontext + Emoji LoRA).', inputs: [{ name: 'input_image', type: 'IMAGE' }], outputs: IMG,
    intents: ['make an emoji', 'turn me into an emoji', 'emoji of this face', 'ios emoji style', 'memoji', 'emojify', 'apple emoji of me', 'convert photo to emoji', 'emoji sticker'] },
  { nodeType: 'ConsistentFaceNode', kind: 'generator', title: 'Generate a consistent face', summary: 'Generate the same character across scenes/poses from one reference face.', inputs: [{ name: 'reference_image', type: 'IMAGE' }], outputs: IMG,
    intents: ['same character again', 'keep the same face', 'consistent character', 'this person in a new scene', 'same person different pose', 'character consistency', 'reuse this face', 'same face new outfit', 'generate the same person', 'keep identity consistent'] },
  { nodeType: 'SketchToImageNode', kind: 'generator', title: 'Sketch to image', summary: 'Turn a rough sketch/line drawing into a finished image, keeping composition.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['turn my sketch into an image', 'finish my drawing', 'sketch to image', 'make my doodle real', 'render my line art', 'drawing to photo', 'colorize my sketch', 'complete this drawing', 'scribble to image', 'make my sketch realistic'] },
  { nodeType: 'TextEffectNode', kind: 'generator', title: 'Text effect', summary: 'Render a word as typographic art (liquid chrome, holographic, brutalist…).', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['make a text effect', 'stylize this word', 'typographic art', 'chrome text', 'holographic letters', 'make a logo word', 'fancy text', 'word art', '3d text effect', 'liquid metal text', 'title treatment', 'neon text'] },

  // ---- Image · editing & transformation ----
  { nodeType: 'EditImageNode', kind: 'effect', title: 'Edit an image', summary: 'Natural-language image editing (Nano Banana / Flux Kontext) — change, add, remove anything.', inputs: [{ name: 'input_image', type: 'IMAGE' }], outputs: IMG,
    intents: ['edit this image', 'change the color of', 'change her shirt', 'make her hair blue', 'change the background', 'edit the photo', 'modify this picture', 'alter the image', 'change the sky', 'make it nighttime', 'tweak this image', 'photoshop this', 'photoshop out', 'add an object', 'add a hat', 'put glasses on', 'add a logo to the image',
      // Object removal / replacement is an EDIT (not background removal) — specific
      // enough to beat RemoveBackground for "remove the <thing>".
      'remove an object', 'remove the person', 'remove the car', 'remove the object', 'erase the object', 'get rid of the object'] },
  { nodeType: 'RestyleFromImageNode', kind: 'effect', title: 'Restyle from image', summary: 'Apply the style of one reference image onto another content image.', inputs: [{ name: 'content_image', type: 'IMAGE' }, { name: 'style_image', type: 'IMAGE' }], outputs: IMG,
    intents: ['apply this style', 'make it look like this', 'style transfer', 'restyle using this image', 'use this as a style reference', 'match this aesthetic', 'transfer the look', 'paint in this style', 'copy the style of', 'give it this vibe'] },
  { nodeType: 'RestyleWithLoRANode', kind: 'effect', title: 'Restyle with a trained LoRA', summary: 'Restyle a content image with a trained LoRA, keeping structure.', inputs: [{ name: 'content_image', type: 'IMAGE' }], outputs: IMG,
    intents: ['restyle with my lora', 'restyle with my trained model', 'convert this using my lora', 'use my trained style lora', 'my lora on this photo', 'stylize with my finetune'] },
  { nodeType: 'BlendSceneNode', kind: 'effect', title: 'Blend scene', summary: 'Harmonize a flat composite into one cohesive photo — unified lighting + contact shadows.', inputs: [{ name: 'image', type: 'IMAGE' }, { name: 'keep_subject', type: 'MASK' }], outputs: IMG,
    intents: ['blend these together', 'make it look like one photo', 'harmonize the composite', 'match the lighting', 'make the pasted object fit', 'add realistic shadows', 'merge the scene', 'unify this composite', 'integrate the cutout'] },
  { nodeType: 'ProductShotNode', kind: 'effect', title: 'Product shot', summary: 'Product photo + scene → studio-quality product shot, product kept pixel-exact.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['make a product shot', 'studio photo of my product', 'put my product in a scene', 'professional product photography', 'ecommerce photo', 'stage my product', 'product on a background', 'marketing shot of this', 'product mockup scene', 'commercial product image', 'advertising photo'] },
  { nodeType: 'RotateCameraNode', kind: 'effect', title: 'Rotate camera', summary: 'Re-render an image from a new viewpoint via a 3-axis gimbal.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['rotate the camera', 'show me another angle', 'view from the side', 'turn it around', 'different viewpoint', 'see the back', 'change the angle', 'from above', 'low angle shot', 'spin the view', 'new camera position'] },
  { nodeType: 'OutpaintImageNode', kind: 'effect', title: 'Expand / outpaint', summary: 'Extend an image beyond its borders; model invents new surroundings.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['expand the image', 'outpaint', 'extend the canvas', 'zoom out', 'make it wider', 'uncrop', 'add more around', 'fill in the edges', 'extend the background', 'make it landscape', 'widen the photo', 'generative expand', 'add space around the subject'] },

  // ---- Image · restore, enhance, upscale ----
  { nodeType: 'UpscaleImageNode', kind: 'effect', title: 'Upscale an image', summary: 'Upscale with a selectable engine (Clarity, Real-ESRGAN, Topaz…).', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    // This is the curated dispatcher — hide the redundant provider/core upscale
    // nodes from the agent so it never picks a raw one (e.g. WaveSpeed) over us.
    supersedes: ['WavespeedImageUpscaleNode', 'ClarityUpscaleRemoteNode', 'MagnificImageUpscalerCreativeNode', 'MagnificImageUpscalerPreciseV2Node', 'RecraftCrispUpscaleNode', 'RecraftCreativeUpscaleNode', 'StabilityUpscaleConservativeNode', 'StabilityUpscaleCreativeNode', 'StabilityUpscaleFastNode', 'ImageUpscaleWithModel', 'ImageScale', 'ImageScaleBy'],
    intents: ['upscale this', 'make it higher resolution', 'increase resolution', 'enlarge the image', 'make it bigger', '4k upscale', 'improve resolution', 'hd this image', 'super resolution', 'upres', 'make it high res', 'scale up the photo'] },
  { nodeType: 'EnhanceDetailNode', kind: 'effect', title: 'Enhance detail', summary: 'Add realistic fine detail in place (no resize).', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['enhance the detail', 'add detail', 'make it sharper', 'sharpen this', 'sharpen up', 'sharpen the image', 'deblur', 'fix blurry photo', 'improve the quality', 'add realism', 'refine this image', 'make it more detailed', 'add fine detail', 'increase clarity', 'make it crisper', 'polish the image'] },
  { nodeType: 'RestorePhotoNode', kind: 'effect', title: 'Restore an old photo', summary: 'Restore old/damaged/faded photos; can colorize black-and-white.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['restore this old photo', 'fix my old photograph', 'repair damaged photo', 'colorize this black and white', 'remove scratches', 'fix the fading', 'old photo restoration', 'bring this photo back to life', 'restore a vintage photo', 'modernize an old picture'] },
  { nodeType: 'FixFacesNode', kind: 'effect', title: 'Fix faces', summary: 'Face-specific restoration (CodeFormer) — sharpen/de-blur/reconstruct faces.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG,
    intents: ['fix the faces', 'restore the face', 'sharpen the face', 'deblur the face', 'fix blurry faces', 'reconstruct the face', 'clean up the face', 'fix the eyes', 'repair distorted face', 'enhance faces', 'fix ai face artifacts'] },
  { nodeType: 'RemoveBackgroundNode', kind: 'effect', title: 'Remove background', summary: 'Fast alpha-matte background removal.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: IMG, boost: 3,
    intents: ['remove the background', 'cut out the subject', 'make it transparent', 'make this transparent', 'isolate the person', 'knock out the background', 'remove bg', 'transparent png', 'delete the background', 'extract the subject', 'matte the image', 'clear background', 'background removal', 'cutout', 'remove backdrop', 'take the background out', 'take out the background', 'get rid of the background', 'no background', 'on a transparent backdrop', 'transperent', 'transparant'] },

  // ---- Image · decompose & analyze ----
  { nodeType: 'SplitPhotoLayersNode', kind: 'effect', title: 'Split photo into layers', summary: 'Decompose into a transparent subject cutout + a clean background plate.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'subject', type: 'IMAGE' }, { name: 'background', type: 'IMAGE' }],
    intents: ['split into layers', 'separate subject and background', 'extract foreground and background', 'remove the subject and fill the hole', 'clean plate', 'decompose this photo', 'subject cutout plus background', 'layer this image', 'pull the subject out'] },
  { nodeType: 'LayerizeGraphicNode', kind: 'effect', title: 'Layerize a graphic', summary: 'Split a flat design into a text-free background + structured text-layer data.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'background', type: 'IMAGE' }, { name: 'layers_json', type: 'STRING' }],
    intents: ['layerize this design', 'split the poster into layers', 'extract the text layers', 'make this editable', 'separate the text from the background', 'decompose this graphic', 'convert to editable design', 'deconstruct the layout', 'edit this poster as layers'] },
  { nodeType: 'DescribeImageNode', kind: 'effect', title: 'Describe an image', summary: 'Vision-language captions, Q&A, counting → text.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'description', type: 'STRING' }],
    intents: ['describe this image', "what's in this picture", 'caption this', 'what do you see', 'tell me about this image', 'explain this photo', 'analyze the image', 'count the people in this', 'ask about the image', 'image caption', 'interpret this picture'] },
  { nodeType: 'ExtractTextNode', kind: 'effect', title: 'Extract text (OCR)', summary: 'OCR — extract text from a photo, screenshot, or document.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'text', type: 'STRING' }],
    intents: ['extract the text', 'ocr this', 'read the text in this image', 'get the text from this screenshot', 'transcribe this document', 'what does the sign say', 'pull the text out', 'read this receipt', 'digitize this document', 'recognize the text'] },
  { nodeType: 'FindObjectsNode', kind: 'effect', title: 'Find objects', summary: 'Open-vocabulary object detection → bounding boxes JSON.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'detections_json', type: 'STRING' }],
    intents: ['find objects in this', 'detect the', 'locate the people', 'where is the', 'bounding boxes for', 'object detection', 'find all the cars', 'identify objects', 'spot the', 'detect items in the image'] },

  // ---- Video ----
  { nodeType: 'GenerateVideoNode', kind: 'generator', title: 'Generate a video', summary: 'Text/image-to-video; gallery of models; optional first frame + audio.', inputs: [{ name: 'image', type: 'IMAGE' }, { name: 'audio', type: 'AUDIO' }], outputs: [{ name: 'VIDEO', type: 'VIDEO' }],
    intents: ['generate a video', 'make a video', 'create a clip', 'make a clip from a picture', 'clip from a photo', 'video from a picture', 'text to video', 'animate this image', 'turn this photo into a video', 'image to video', 'make it move', 'ai video', 'video of', 'bring this to life', 'make a short clip', 'animate'] },
  { nodeType: 'FilmShotNode', kind: 'generator', title: 'Film a shot', summary: 'Cinematic shot generator — named camera-move presets.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'VIDEO', type: 'VIDEO' }],
    intents: ['film a shot', 'cinematic video', 'dolly zoom', 'push in shot', 'make a movie shot', 'camera move video', 'tracking shot', 'pan across', 'crane shot', 'cinematic clip of this', 'slow push in', 'establishing shot'] },
  { nodeType: 'LipsyncNode', kind: 'effect', title: 'Lip sync to audio', summary: 'Drive a face\'s lips to match an audio track (needs a video URL + audio).', inputs: [{ name: 'audio', type: 'AUDIO' }], outputs: [{ name: 'VIDEO', type: 'VIDEO' }],
    intents: ['lip sync this', 'sync the lips to audio', 'make the face talk', 'talking head video', 'dub this video', 'match lips to speech', 'lipsync', 'animate the mouth to audio', 'talking portrait'] },
  { nodeType: 'EnhanceVideoNode', kind: 'effect', title: 'Enhance a video', summary: 'Upscale + denoise + sharpen video (needs a video URL).', inputs: [], outputs: [{ name: 'VIDEO', type: 'VIDEO' }],
    intents: ['enhance the video', 'upscale this video', 'make the video hd', 'improve video quality', '4k the video', 'denoise the video', 'sharpen the video', 'clean up this clip', 'increase video resolution', 'restore this video'] },
  { nodeType: 'DescribeVideoNode', kind: 'effect', title: 'Describe a video', summary: 'Video + question → text (captions, summaries). Needs a video URL.', inputs: [], outputs: [{ name: 'description', type: 'STRING' }],
    intents: ['describe this video', 'what happens in this video', 'summarize the video', 'caption the clip', 'analyze the footage', "what's going on in this video", 'explain the video', 'video summary'] },

  // ---- Audio ----
  { nodeType: 'GenerateMusicNode', kind: 'generator', title: 'Generate music', summary: 'Text-to-music — describe mood/genre/instruments.', inputs: [], outputs: [{ name: 'AUDIO', type: 'AUDIO' }],
    intents: ['generate music', 'make a song', 'create background music', 'text to music', 'compose a track', 'lo-fi beat', 'make some music', 'instrumental for', 'generate a melody', 'background track', 'ai music', 'make a jingle', 'soundtrack for'] },
  { nodeType: 'GenerateSpeechNode', kind: 'generator', title: 'Generate speech', summary: 'Natural text-to-speech with emotion + voice control; supports cloned voices.', inputs: [], outputs: [{ name: 'AUDIO', type: 'AUDIO' }],
    intents: ['generate speech', 'text to speech', 'read this aloud', 'read out loud', 'read it aloud', 'out loud', 'make a voiceover', 'narrate this', 'tts', 'say this', 'voice this text', 'create a narration', 'speak this', 'ai voice', 'make it talk', 'voice over'] },
  { nodeType: 'TranscribeAudioNode', kind: 'effect', title: 'Transcribe audio', summary: 'Audio → text (Whisper) with language detection.', inputs: [{ name: 'audio', type: 'AUDIO' }], outputs: [{ name: 'transcript', type: 'STRING' }],
    intents: ['transcribe this audio', 'speech to text', 'what is said in this', 'get the transcript', 'convert audio to text', 'subtitle this', 'transcribe the recording', 'captions from audio', 'transcribe the podcast'] },
  { nodeType: 'IdentifySpeakersNode', kind: 'effect', title: 'Identify speakers', summary: 'Diarization + transcription — who said what, as JSON.', inputs: [{ name: 'audio', type: 'AUDIO' }], outputs: [{ name: 'segments_json', type: 'STRING' }],
    intents: ['who said what', 'identify the speakers', 'diarize this audio', 'label the speakers', 'separate the speakers', 'speaker diarization', 'tag who is talking', 'transcribe this interview by speaker'] },
  { nodeType: 'CloneSingingVoiceNode', kind: 'effect', title: 'Clone a singing voice', summary: 'Re-sing a song in a different voice (RVC).', inputs: [{ name: 'audio', type: 'AUDIO' }], outputs: [{ name: 'AUDIO', type: 'AUDIO' }],
    intents: ['clone this singing voice', 're-sing this song', 'change the singer', 'ai cover', 'rvc voice', 'voice convert this song', 'cover this in another voice', 'swap the vocals', 'sing in a different voice'] },

  // ---- 3D ----
  { nodeType: 'Generate3DNode', kind: 'generator', title: 'Generate a 3D model', summary: 'Image-to-3D (Hunyuan3D) → textured GLB mesh.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'glb_url', type: 'STRING' }],
    intents: ['make a 3d model', 'image to 3d', 'turn this into a 3d model', 'generate a mesh', 'create a 3d object', '3d from photo', 'make a glb', 'convert to 3d', 'model this in 3d', '3d asset from image', 'make it 3d'] },
  { nodeType: 'Hunyuan3DMultiViewNode', kind: 'generator', title: 'Multi-view → 3D', summary: 'Reconstruct a 3D model from a front/back/left/right character sheet.', inputs: [{ name: 'front_image', type: 'IMAGE' }, { name: 'back_image', type: 'IMAGE' }, { name: 'left_image', type: 'IMAGE' }, { name: 'right_image', type: 'IMAGE' }], outputs: [{ name: 'glb_url', type: 'STRING' }],
    intents: ['3d from multiple views', 'character sheet to 3d', 'make a 3d model from front and back', 'multi-view 3d', 'turn these views into a model', '3d from turnaround', 'build a 3d character from views'] },

  // ---- Text / LLM utilities ----
  { nodeType: 'ImprovePromptNode', kind: 'effect', title: 'Improve a prompt', summary: 'Rewrite a rough idea into a detailed image/video prompt.', inputs: [], outputs: [{ name: 'improved_prompt', type: 'STRING' }],
    intents: ['improve my prompt', 'make this prompt better', 'expand my prompt', 'enhance the prompt', 'write a better prompt', 'optimize this prompt', 'flesh out my prompt', 'turn my idea into a prompt'] },
  { nodeType: 'ChatLLMNode', kind: 'effect', title: 'Chat with an LLM', summary: 'Send a prompt to a frontier LLM → text.', inputs: [], outputs: [{ name: 'response', type: 'STRING' }],
    intents: ['ask an llm', 'chat with ai', 'ask a question', 'use gpt', 'ask claude', 'talk to an ai', 'get a written answer', 'write me a paragraph', 'query a language model'] },
  { nodeType: 'SummarizeTextNode', kind: 'effect', title: 'Summarize text', summary: 'Compress long text into a short summary.', inputs: [], outputs: [{ name: 'summary', type: 'STRING' }],
    intents: ['summarize this', 'tldr', 'give me a summary', 'condense this text', 'shorten this', 'key points', 'summarize the transcript', 'bullet point summary', 'boil this down', 'recap this'] },
  { nodeType: 'TranslateTextNode', kind: 'effect', title: 'Translate text', summary: 'Translate text between languages, tone-preserving.', inputs: [], outputs: [{ name: 'translation', type: 'STRING' }],
    intents: ['translate this', 'translate to spanish', 'what does this say in english', 'convert to french', 'translate the text', 'say this in german', 'localize this', 'translate into japanese'] },
  { nodeType: 'RewriteToneNode', kind: 'effect', title: 'Rewrite in a tone', summary: 'Rewrite text in a different tone without changing meaning.', inputs: [], outputs: [{ name: 'rewritten', type: 'STRING' }],
    intents: ['rewrite this', 'make it more formal', 'make it casual', 'make it punchier', 'change the tone', 'reword this', 'make it sound friendly', 'rephrase this', 'make it professional', 'polish this copy'] },
  { nodeType: 'BrainstormIdeasNode', kind: 'effect', title: 'Brainstorm ideas', summary: 'Generate N distinct ideas from a topic.', inputs: [], outputs: [{ name: 'ideas', type: 'STRING' }],
    intents: ['brainstorm ideas', 'give me variations', 'list some ideas', 'generate options', 'ideas for', 'come up with concepts', 'suggest some', 'different angles on', 'give me alternatives', 'ideate'] },
]

// ─────────────────────────────────────────────────────────────────────────────
// STUDIOS — the app's creative editors, added as canvas nodes. Gradient/Shader/
// Texture/SpaceType are FRONTEND-ONLY (no /object_info) → frontendOnly:true so we
// synthesize their catalog entry + ports (wildcard output; ShaderStudio takes an
// IMAGE). Compositor + SmartLayout are REAL backend nodes (ports come from
// /object_info), so frontendOnly is false — we only add their intents + boost.
// ─────────────────────────────────────────────────────────────────────────────
const STUDIOS: AgentCapability[] = [
  { nodeType: 'GradientStudio', kind: 'studio', frontendOnly: true, title: 'Gradient Studio', summary: 'Procedural WebGL gradient generator — color fields, mesh, liquid/marble flow, 3D relief, looping video.', inputs: [], outputs: [{ name: 'output', type: '*' }],
    intents: ['make a gradient', 'gradient background', 'add a gradient', 'colour gradient', 'color mesh', 'mesh gradient', 'liquid gradient', 'marble gradient', 'abstract color backdrop', 'soft color wash', 'smooth colour blend', 'smooth color blend', 'blend of colours', 'colour blend behind', 'radial gradient', 'linear gradient', 'rainbow gradient', 'animated gradient', 'ombre background', 'colorful abstract background', 'aurora color field'] },
  { nodeType: 'ShaderStudio', kind: 'studio', frontendOnly: true, title: 'Shader Studio', summary: 'Real-time WebGL shader compositor (~48 effects: distortion, stylize, generative, blur, glow, lens, color).', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'output', type: '*' }],
    intents: ['apply a shader', 'stylize this image', 'add an effect to the image', 'halftone effect', 'dither effect', 'ascii art effect', 'pixelate', 'duotone', 'glitch effect', 'rgb glitch', 'chromatic aberration', 'kaleidoscope', 'oil painting effect', 'crosshatch', 'crt scanlines', 'holographic foil', 'posterize', 'vignette', 'bloom glow', 'wave swirl distortion', 'liquify', 'generative background'] },
  { nodeType: 'TextureStudio', kind: 'studio', frontendOnly: true, title: 'Pattern / Texture Studio', summary: 'Tileable seamless-texture generator — procedural motifs, Truchet tiles, 12 geometric shape families, AI text-to-texture.', inputs: [], outputs: [{ name: 'output', type: '*' }],
    intents: ['tileable pattern', 'seamless texture', 'make a pattern', 'repeating pattern', 'geometric pattern', 'truchet tiles', 'herringbone pattern', 'hex tile pattern', 'checkerboard pattern', 'stripes pattern', 'polka dot pattern', 'basketweave', 'fish-scale pattern', 'seamless tile', 'wallpaper pattern', 'fabric texture'] },
  { nodeType: 'ShotDirector', kind: 'studio', frontendOnly: true, title: 'Shot Director', summary: 'Guardrailed shot-sheet UI for directing video models (Seedance 2.0 and others) — fill in a shot sheet, get terse best-practice prompts, drive Seedance per-model profiles.', inputs: [{ name: 'reference', type: 'IMAGE', optional: true }], outputs: [{ name: 'output', type: '*' }],
    intents: ['seedance', 'direct a video', 'shot director', 'film a shot', 'video shot', 'shot sheet', 'camera direction', 'direct a shot', 'video direction', 'seedance prompt', 'shot-director'] },
  { nodeType: 'SpaceType', kind: 'studio', frontendOnly: true, title: 'Type Studio', summary: '3D kinetic typography engine — pick an effect, type text, bake to image/video; fills + post-FX.', inputs: [], outputs: [{ name: 'output', type: '*' }],
    intents: ['kinetic typography', 'animated text', 'animate text', 'animate the word', 'animated word', 'animate this text', '3d text', '3d text effect', 'text animation', 'spinning text', 'text on a sphere', 'text tunnel', 'glitchy text', 'melting text', 'spiral text', 'elastic stretchy text', 'ribbon text', 'type studio', 'animated title', 'motion typography', 'extruded text', 'text on a cylinder', 'text intro animation'] },
  { nodeType: 'Compositor', kind: 'studio', frontendOnly: false, title: 'Frame (Compositor)', summary: 'Figma-style layer compositor / artboard — stack image + text/vector/shape layers with transforms, blend, masking, motion.', inputs: [{ name: 'layer1', type: 'IMAGE' }], outputs: [{ name: 'image', type: 'IMAGE' }],
    intents: ['compose a frame', 'create a frame', 'add this to a frame', 'put the image in a frame', 'place it on an artboard', 'new artboard', 'layout layers', 'combine these into one image', 'merge images into a composition', 'overlay images', 'stack layers', 'add text over the image', 'add a caption', 'put a logo on this', 'arrange elements on a canvas', 'draw a shape on top', 'add a vector', 'design a composite',
      // Solid/coloured frame background (the backdrop behind the layers) — NOT a
      // gradient. Owns "make the background blue" once it's in a frame.
      'solid background colour', 'solid background color', 'blue background', 'coloured background', 'colored background', 'set the background colour', 'set the background color', 'make the background blue', 'fill the background with a colour', 'put it on a coloured background', 'give it a solid background', 'frame background colour', 'backdrop colour behind the layers'] },
  { nodeType: 'SmartLayout', kind: 'studio', frontendOnly: false, title: 'Smart Layout', summary: 'Format-aware Swiss/International-style auto-layout — design once, reflow to many ad aspect ratios; brand-themed.', inputs: [{ name: 'image_layer_1', type: 'IMAGE' }, { name: 'text_layer_1', type: 'STRING' }], outputs: [{ name: 'images', type: 'IMAGE' }],
    intents: ['make a poster layout', 'design a layout', 'auto-layout', 'arrange into a composition', 'create an ad layout', 'social media post layout', 'lay this out nicely', 'arrange text and images', 'make a flyer', 'design a banner', 'multi-format layout', 'resize this design to other formats', 'adapt to story or square', 'swiss design poster', 'grid layout', 'headline and body layout', 'brand-styled layout'] },
]

export const AGENT_CAPABILITIES: AgentCapability[] = [...STUDIOS, ...GENERATORS]
