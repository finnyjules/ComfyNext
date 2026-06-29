import { describe, it, expect } from 'vitest'
import { AGENT_CAPABILITIES, capabilityBoosts, capabilityKeywords, studioNodeTypes } from '~/lib/agent/capabilities'
import { searchNodes } from '~/lib/nodeMatch'
import { buildCatalog } from '~/lib/portIntentCatalog'
import { NODE_BOOST, NODE_KEYWORDS } from '~/lib/nodeKeywords'

/**
 * Exhaustive routing corpus for the canvas agent's discovery layer. The agent's
 * palette is built by searchNodes/buildCatalog over /object_info + the capability
 * registry; if a phrasing doesn't surface the right capability HERE, the agent
 * can't pick it. So this asserts, deterministically (no LLM):
 *   1. every capability's own intent vocabulary routes back to it,
 *   2. realistic paraphrases (NOT verbatim intents) route correctly,
 *   3. flagship phrasings land #1,
 *   4. capabilities beat raw ComfyUI nodes for creative requests,
 *   5. known collisions disambiguate to the right capability.
 */

interface MatchableNode { name: string; displayName: string; description: string; category: string }

// Capabilities as matchable nodes (what buildCatalog feeds the matcher).
const CAP_NODES: MatchableNode[] = AGENT_CAPABILITIES.map(c => ({
  name: c.nodeType, displayName: c.title, description: c.summary, category: c.kind,
}))

// Realistic raw ComfyUI distractors — capabilities must out-rank these for
// creative intents (so the agent doesn't surface a low-level node instead).
const RAW: MatchableNode[] = [
  { name: 'KSampler', displayName: 'KSampler', description: 'Denoise a latent image with a sampler and scheduler.', category: 'sampling' },
  { name: 'CLIPTextEncode', displayName: 'CLIP Text Encode (Prompt)', description: 'Encode a text prompt into a conditioning.', category: 'conditioning' },
  { name: 'VAEDecode', displayName: 'VAE Decode', description: 'Decode a latent into an image.', category: 'latent' },
  { name: 'VAEEncode', displayName: 'VAE Encode', description: 'Encode an image into a latent.', category: 'latent' },
  { name: 'LoadImage', displayName: 'Load Image', description: 'Load an image from disk.', category: 'image' },
  { name: 'SaveImage', displayName: 'Save Image', description: 'Save images to the output folder.', category: 'image' },
  { name: 'EmptyLatentImage', displayName: 'Empty Latent Image', description: 'Create an empty latent of a given size.', category: 'latent' },
  { name: 'CheckpointLoaderSimple', displayName: 'Load Checkpoint', description: 'Load a model checkpoint.', category: 'loaders' },
  { name: 'LoraLoader', displayName: 'Load LoRA', description: 'Apply a LoRA to a model and clip.', category: 'loaders' },
  { name: 'ControlNetApply', displayName: 'Apply ControlNet', description: 'Apply a ControlNet to a conditioning.', category: 'conditioning' },
  { name: 'ImageScale', displayName: 'Upscale Image', description: 'Resize an image to a target resolution.', category: 'image' },
  { name: 'ImageBlur', displayName: 'Image Blur', description: 'Gaussian blur an image.', category: 'image/postprocessing' },
  { name: 'ImageColorToMask', displayName: 'Image Color To Mask', description: 'Turn a color into a mask.', category: 'mask' },
  { name: 'ConditioningCombine', displayName: 'Conditioning (Combine)', description: 'Combine two conditionings.', category: 'conditioning' },
  { name: 'ImageInvert', displayName: 'Invert Image', description: 'Invert the colors of an image.', category: 'image' },
  // Harder distractors: real ComfyUI core nodes with creative-ish names that
  // could plausibly collide with a capability.
  { name: 'ImageBlend', displayName: 'Image Blend', description: 'Alpha-blend two images together by a factor.', category: 'image/postprocessing' },
  { name: 'ImageCompositeMasked', displayName: 'Image Composite Masked', description: 'Composite a source image onto a destination using a mask.', category: 'image' },
  { name: 'LatentBlend', displayName: 'Latent Blend', description: 'Blend two latents.', category: 'latent' },
  { name: 'ImageUpscaleWithModel', displayName: 'Upscale Image (using Model)', description: 'Upscale an image with an upscale model.', category: 'image/upscaling' },
  { name: 'GrowMask', displayName: 'Grow Mask', description: 'Grow or shrink a mask.', category: 'mask' },
  { name: 'ImagePadForOutpaint', displayName: 'Pad Image for Outpainting', description: 'Add padding around an image for outpainting.', category: 'image' },
  { name: 'PorterDuffImageComposite', displayName: 'Porter-Duff Image Composite', description: 'Composite images with Porter-Duff modes.', category: 'mask/compositing' },
  { name: 'ImageColorize', displayName: 'Image Colorize', description: 'Colorize a grayscale image.', category: 'image' },
  { name: 'TextMultiline', displayName: 'Text Multiline', description: 'A multiline text string.', category: 'utils' },
  { name: 'SaveАudioMP3', displayName: 'Save Audio (MP3)', description: 'Save audio to an mp3 file.', category: 'audio' },
]

const ALL: MatchableNode[] = [...CAP_NODES, ...RAW]
const keywords = { ...NODE_KEYWORDS, ...capabilityKeywords() }
const boosts = { ...NODE_BOOST, ...capabilityBoosts() }

function topN(phrase: string, n = 3): string[] {
  return searchNodes(ALL, phrase, { keywords, boosts, limit: n }).map(x => x.name)
}

describe('capability registry sanity', () => {
  it('every nodeType is unique', () => {
    const names = AGENT_CAPABILITIES.map(c => c.nodeType)
    expect(new Set(names).size).toBe(names.length)
  })
  it('every capability has intents, title, summary, ports', () => {
    for (const c of AGENT_CAPABILITIES) {
      expect(c.intents.length, c.nodeType).toBeGreaterThanOrEqual(6)
      expect(c.title.length, c.nodeType).toBeGreaterThan(0)
      expect(c.summary.length, c.nodeType).toBeGreaterThan(0)
      expect(Array.isArray(c.inputs) && Array.isArray(c.outputs), c.nodeType).toBe(true)
    }
  })
})

// 1. Every capability's own intent vocabulary must route back to it (top-3).
//    This catches collisions across the WHOLE registry — if intent X for cap A
//    surfaces cap B first, the vocabulary is ambiguous and must be fixed.
describe('intent vocabulary routes to its owner (top-3)', () => {
  for (const cap of AGENT_CAPABILITIES) {
    it(`${cap.nodeType}: all ${cap.intents.length} intents`, () => {
      const misses = cap.intents.filter(intent => !topN(intent, 3).includes(cap.nodeType))
      expect(misses, `intents not routing to ${cap.nodeType}`).toEqual([])
    })
  }
})

// 2. Realistic paraphrases that are NOT verbatim intents — tests generalization.
const PARAPHRASES: { phrase: string; expect: string }[] = [
  { phrase: 'i need this person on a transparent backdrop', expect: 'RemoveBackgroundNode' },
  { phrase: 'give me a sunset gradient backdrop', expect: 'GradientStudio' },
  { phrase: 'i want a smooth colour blend behind it', expect: 'GradientStudio' },
  { phrase: 'turn this into a repeating wallpaper', expect: 'TextureStudio' },
  { phrase: 'make a seamless fabric pattern', expect: 'TextureStudio' },
  { phrase: 'apply a halftone comic look to the picture', expect: 'ShaderStudio' },
  { phrase: 'make a picture of a golden retriever', expect: 'GenerateImageNode' },
  { phrase: 'render an illustration of a castle', expect: 'GenerateImageNode' },
  { phrase: 'bump up the resolution of this', expect: 'UpscaleImageNode' },
  { phrase: 'this is too small, enlarge it', expect: 'UpscaleImageNode' },
  { phrase: 'extend the photo to a wider shot', expect: 'OutpaintImageNode' },
  { phrase: 'fill in more scenery around the edges', expect: 'OutpaintImageNode' },
  { phrase: 'the faces look mangled, fix them', expect: 'FixFacesNode' },
  { phrase: 'repair my grandparents old photograph', expect: 'RestorePhotoNode' },
  { phrase: 'put my sneaker in a studio scene', expect: 'ProductShotNode' },
  { phrase: 'animate this still image into a clip', expect: 'GenerateVideoNode' },
  { phrase: 'compose a short cinematic dolly shot', expect: 'FilmShotNode' },
  { phrase: 'write some lo-fi background music', expect: 'GenerateMusicNode' },
  { phrase: 'read this paragraph out loud', expect: 'GenerateSpeechNode' },
  { phrase: 'what does this picture show', expect: 'DescribeImageNode' },
  { phrase: 'pull the words out of this screenshot', expect: 'ExtractTextNode' },
  { phrase: 'turn this character into a 3d mesh', expect: 'Generate3DNode' },
  { phrase: 'lay these out as an instagram post', expect: 'SmartLayout' },
  { phrase: 'arrange a poster with a headline', expect: 'SmartLayout' },
  { phrase: 'stack these images into one frame', expect: 'Compositor' },
  { phrase: 'overlay a caption on the photo', expect: 'Compositor' },
  { phrase: 'put this image in a frame on a solid blue background', expect: 'Compositor' },
  { phrase: 'give the frame a coloured backdrop behind the layers', expect: 'Compositor' },
  { phrase: 'animate the word welcome in 3d', expect: 'SpaceType' },
  { phrase: 'change her shirt to red', expect: 'EditImageNode' },
  { phrase: 'restyle this in the look of that reference', expect: 'RestyleFromImageNode' },
  { phrase: 'show this object from another angle', expect: 'RotateCameraNode' },
  { phrase: 'make a same-character image in a new pose', expect: 'ConsistentFaceNode' },
  { phrase: 'turn my doodle into a real picture', expect: 'SketchToImageNode' },
  // More generators / generation
  { phrase: 'create a watercolor painting of a fox', expect: 'GenerateImageNode' },
  { phrase: 'dream up a sci-fi cityscape', expect: 'GenerateImageNode' },
  { phrase: 'make an anime version of a samurai', expect: 'GenerateAnimeNode' },
  { phrase: 'turn this selfie into an emoji', expect: 'GenerateEmojiNode' },
  { phrase: 'compose a chill instrumental beat', expect: 'GenerateMusicNode' },
  { phrase: 'narrate this script in a calm voice', expect: 'GenerateSpeechNode' },
  { phrase: 'build a 3d asset from this reference', expect: 'Generate3DNode' },
  { phrase: 'make a cool effect for the word SALE', expect: 'TextEffectNode' },
  // More editing / transform
  { phrase: 'add a hat to the person', expect: 'EditImageNode' },
  { phrase: 'swap the sky for a sunset', expect: 'EditImageNode' },
  { phrase: 'make this look like a studio product photo', expect: 'ProductShotNode' },
  { phrase: 'see this car from the rear', expect: 'RotateCameraNode' },
  { phrase: 'make the picture wider on both sides', expect: 'OutpaintImageNode' },
  { phrase: 'paint this in the style of that reference image', expect: 'RestyleFromImageNode' },
  // More restore / enhance
  { phrase: 'sharpen up this blurry photo', expect: 'EnhanceDetailNode' },
  { phrase: 'colourise this old black and white photo', expect: 'RestorePhotoNode' },
  { phrase: 'the eyes came out distorted, repair them', expect: 'FixFacesNode' },
  { phrase: 'make this 4k', expect: 'UpscaleImageNode' },
  // Decompose / analyze
  { phrase: 'separate the person from the backdrop into two layers', expect: 'SplitPhotoLayersNode' },
  { phrase: 'split this poster into editable text layers', expect: 'LayerizeGraphicNode' },
  { phrase: 'how many people are in this photo', expect: 'DescribeImageNode' },
  { phrase: 'scan the text on this receipt', expect: 'ExtractTextNode' },
  { phrase: 'locate every car in the image', expect: 'FindObjectsNode' },
  // Video / audio
  { phrase: 'make a clip from this picture', expect: 'GenerateVideoNode' },
  { phrase: 'shoot a slow push-in on this scene', expect: 'FilmShotNode' },
  { phrase: 'write out everything said in this recording', expect: 'TranscribeAudioNode' },
  { phrase: 'who is speaking when in this interview', expect: 'IdentifySpeakersNode' },
  // Studios
  { phrase: 'put a soft gradient wash behind the headline', expect: 'GradientStudio' },
  { phrase: 'give me a seamless geometric tile', expect: 'TextureStudio' },
  { phrase: 'add a pixelate effect', expect: 'ShaderStudio' },
  { phrase: 'apply a duotone effect to this', expect: 'ShaderStudio' },
  { phrase: 'design an ad that adapts to story and square', expect: 'SmartLayout' },
  { phrase: 'place these three photos in one artboard', expect: 'Compositor' },
  { phrase: 'make the title text fly in 3d', expect: 'SpaceType' },
  // Text utilities
  { phrase: 'shorten this into a tldr', expect: 'SummarizeTextNode' },
  { phrase: 'translate this caption to spanish', expect: 'TranslateTextNode' },
  { phrase: 'make this copy sound more playful', expect: 'RewriteToneNode' },
  { phrase: 'give me ten name ideas for this brand', expect: 'BrainstormIdeasNode' },
  { phrase: 'turn my rough idea into a detailed prompt', expect: 'ImprovePromptNode' },
]

describe('paraphrases route to the right capability (top-3)', () => {
  for (const { phrase, expect: exp } of PARAPHRASES) {
    it(`"${phrase}" → ${exp}`, () => {
      expect(topN(phrase, 3)).toContain(exp)
    })
  }
})

// 2b. Wide wording sweep (top-3 recall) — slang, abbreviations, typos, casual
//     lowercase, and outcome-framed phrasings from the real-user corpus. Each must
//     still SURFACE the right capability in the palette (the LLM makes the final
//     pick, but it can only pick what discovery surfaces).
const WIDE: { phrase: string; expect: string }[] = [
  // casual / slang / lowercase
  { phrase: 'yo cut this dude out', expect: 'RemoveBackgroundNode' },
  { phrase: 'gimme an ai pic of a robot chef', expect: 'GenerateImageNode' },
  { phrase: 'whip up an illustration of a fox', expect: 'GenerateImageNode' },
  { phrase: 'make me a sick wallpaper of space', expect: 'GenerateImageNode' },
  // abbreviations / shorthand
  { phrase: 'rm bg', expect: 'RemoveBackgroundNode' },
  { phrase: 'gen a photo of ramen', expect: 'GenerateImageNode' },
  { phrase: 'tts this paragraph', expect: 'GenerateSpeechNode' },
  { phrase: 'ocr this screenshot', expect: 'ExtractTextNode' },
  { phrase: 'tldr this article', expect: 'SummarizeTextNode' },
  // typos / misspellings
  { phrase: 'remove the backround', expect: 'RemoveBackgroundNode' },
  { phrase: 'make a gradiant background', expect: 'GradientStudio' },
  { phrase: 'make this transperent', expect: 'RemoveBackgroundNode' },
  // object/photo edits (NOT background removal)
  { phrase: 'erase the power lines from this photo', expect: 'EditImageNode' },
  { phrase: 'photoshop out the trash can', expect: 'EditImageNode' },
  { phrase: 'make it look like nighttime', expect: 'EditImageNode' },
  // enhance / restore / faces
  { phrase: 'make it crisper', expect: 'EnhanceDetailNode' },
  { phrase: 'colorize this black and white photo', expect: 'RestorePhotoNode' },
  { phrase: 'fix these messed up ai faces', expect: 'FixFacesNode' },
  // resolution
  { phrase: 'upres this image', expect: 'UpscaleImageNode' },
  { phrase: 'make this hd', expect: 'UpscaleImageNode' },
  // video / audio
  { phrase: 'bring this photo to life', expect: 'GenerateVideoNode' },
  { phrase: 'image to video', expect: 'GenerateVideoNode' },
  { phrase: 'make a song about summer', expect: 'GenerateMusicNode' },
  { phrase: 'make a voiceover for this script', expect: 'GenerateSpeechNode' },
  { phrase: 'subtitle this audio', expect: 'TranscribeAudioNode' },
  { phrase: 'denoise this clip', expect: 'EnhanceVideoNode' },
  // 3d
  { phrase: 'image to 3d', expect: 'Generate3DNode' },
  // studios
  { phrase: 'ombre background pink to white', expect: 'GradientStudio' },
  { phrase: 'blue to purple gradient background', expect: 'GradientStudio' },
  { phrase: 'add crt scanlines', expect: 'ShaderStudio' },
  { phrase: 'ascii art effect on this', expect: 'ShaderStudio' },
  { phrase: 'herringbone tile pattern', expect: 'TextureStudio' },
  { phrase: 'checkerboard texture', expect: 'TextureStudio' },
  { phrase: 'text on a sphere', expect: 'SpaceType' },
  { phrase: 'melting text animation', expect: 'SpaceType' },
  { phrase: 'overlay these two images', expect: 'Compositor' },
  { phrase: 'stack these as layers', expect: 'Compositor' },
  { phrase: 'make a banner ad', expect: 'SmartLayout' },
  { phrase: 'create a flyer with a headline and body', expect: 'SmartLayout' },
  { phrase: 'chrome text effect for the word BOSS', expect: 'TextEffectNode' },
  { phrase: 'liquid metal text that says SALE', expect: 'TextEffectNode' },
  // shoot / camera / outpaint
  { phrase: 'ecommerce photo of this sneaker', expect: 'ProductShotNode' },
  { phrase: 'show me the side view of this', expect: 'RotateCameraNode' },
  { phrase: 'uncrop this photo', expect: 'OutpaintImageNode' },
  { phrase: 'extend the canvas to the left', expect: 'OutpaintImageNode' },
  // analyze / extract
  { phrase: 'count the people in this image', expect: 'DescribeImageNode' },
  { phrase: 'pull the text off this receipt', expect: 'ExtractTextNode' },
  { phrase: 'draw bounding boxes around the products', expect: 'FindObjectsNode' },
  // text utilities
  { phrase: 'localize this into japanese', expect: 'TranslateTextNode' },
  { phrase: 'rewrite this to sound more formal', expect: 'RewriteToneNode' },
  { phrase: 'come up with ten taglines', expect: 'BrainstormIdeasNode' },
  // generation variants
  { phrase: 'anime portrait of a knight', expect: 'GenerateAnimeNode' },
  { phrase: 'memoji of my face', expect: 'GenerateEmojiNode' },
  { phrase: 'same person in a different outfit', expect: 'ConsistentFaceNode' },
  { phrase: 'turn my scribble into a real picture', expect: 'SketchToImageNode' },
  { phrase: 'paint my photo in the style of this reference', expect: 'RestyleFromImageNode' },
]

describe('wide wording sweep routes correctly (top-3)', () => {
  for (const { phrase, expect: exp } of WIDE) {
    it(`"${phrase}" → ${exp}`, () => {
      expect(topN(phrase, 3)).toContain(exp)
    })
  }
})

// 2c. Genuinely multi-interpretation requests — more than one capability is a
//     reasonable read (the LLM disambiguates from context). The bar here is only
//     that the intended capability stays DISCOVERABLE (top-6), so the model can
//     still choose it. Asserting a strict #1/top-3 for these would be overfitting.
const REACHABLE: { phrase: string; expect: string }[] = [
  { phrase: 'can you take the background out of this photo', expect: 'RemoveBackgroundNode' }, // vs Outpaint/Split/Edit
  { phrase: 'give the image a glitchy vhs vibe', expect: 'ShaderStudio' },                     // vs RestyleFromImage
]
describe('ambiguous requests stay discoverable (top-6)', () => {
  for (const { phrase, expect: exp } of REACHABLE) {
    it(`"${phrase}" → ${exp} in top-6`, () => {
      expect(topN(phrase, 6)).toContain(exp)
    })
  }
})

// 3. Flagship phrasings must land #1 (the unambiguous, most-common requests).
const FLAGSHIP: { phrase: string; expect: string }[] = [
  { phrase: 'remove the background', expect: 'RemoveBackgroundNode' },
  { phrase: 'make it transparent', expect: 'RemoveBackgroundNode' },
  { phrase: 'generate an image', expect: 'GenerateImageNode' },
  { phrase: 'make a gradient', expect: 'GradientStudio' },
  { phrase: 'gradient background', expect: 'GradientStudio' },
  { phrase: 'seamless texture', expect: 'TextureStudio' },
  { phrase: 'tileable pattern', expect: 'TextureStudio' },
  { phrase: 'upscale this', expect: 'UpscaleImageNode' },
  { phrase: 'generate a video', expect: 'GenerateVideoNode' },
  { phrase: 'generate music', expect: 'GenerateMusicNode' },
  { phrase: 'text to speech', expect: 'GenerateSpeechNode' },
  { phrase: 'make a 3d model', expect: 'Generate3DNode' },
  { phrase: 'describe this image', expect: 'DescribeImageNode' },
  { phrase: 'edit this image', expect: 'EditImageNode' },
  { phrase: 'outpaint', expect: 'OutpaintImageNode' },
  { phrase: 'fix the faces', expect: 'FixFacesNode' },
  { phrase: 'product shot', expect: 'ProductShotNode' },
  { phrase: 'make a poster layout', expect: 'SmartLayout' },
  { phrase: 'kinetic typography', expect: 'SpaceType' },
  { phrase: 'apply a shader', expect: 'ShaderStudio' },
]

describe('flagship phrasings land #1', () => {
  for (const { phrase, expect: exp } of FLAGSHIP) {
    it(`"${phrase}" is #1 → ${exp}`, () => {
      expect(topN(phrase, 1)[0]).toBe(exp)
    })
  }
})

// 4. Capabilities beat raw ComfyUI nodes for creative phrasings (no raw node #1).
describe('capabilities out-rank raw ComfyUI nodes', () => {
  const creative = ['make a gradient', 'remove the background', 'upscale this', 'make a pattern', 'generate an image', 'add a caption', 'apply a shader']
  for (const phrase of creative) {
    it(`"${phrase}" → a capability, not a raw node`, () => {
      const top = topN(phrase, 1)[0]
      expect(RAW.map(r => r.name)).not.toContain(top)
    })
  }
})

// 5. Known collisions disambiguate to the intended capability.
describe('collisions disambiguate', () => {
  const cases: { phrase: string; expect: string; notFirst?: string }[] = [
    { phrase: 'remove the background', expect: 'RemoveBackgroundNode', notFirst: 'EditImageNode' },
    { phrase: 'change the background', expect: 'EditImageNode' },
    { phrase: 'make a video', expect: 'GenerateVideoNode', notFirst: 'FilmShotNode' },
    { phrase: 'upscale the video', expect: 'EnhanceVideoNode' },
    { phrase: 'upscale this video to 4k', expect: 'EnhanceVideoNode' },
    { phrase: 'transcribe this audio', expect: 'TranscribeAudioNode', notFirst: 'IdentifySpeakersNode' },
    // face-qualified enhancement must beat the generic image enhancer
    { phrase: 'sharpen the face', expect: 'FixFacesNode' },
    { phrase: 'deblur the face', expect: 'FixFacesNode' },
    { phrase: 'sharpen this image', expect: 'EnhanceDetailNode' },
    // object removal is an EDIT, not background removal
    { phrase: 'remove the person from the photo', expect: 'EditImageNode' },
    { phrase: 'erase the car from this picture', expect: 'EditImageNode' },
    // media-typed summaries / reads disambiguate by noun
    { phrase: 'summarize the video', expect: 'DescribeVideoNode' },
    { phrase: 'summarize this article', expect: 'SummarizeTextNode' },
    { phrase: 'read the text in this image', expect: 'ExtractTextNode' },
    { phrase: 'read this paragraph aloud', expect: 'GenerateSpeechNode' },
    // animate: image → video; a word/title → kinetic type
    { phrase: 'animate this image', expect: 'GenerateVideoNode' },
    { phrase: 'animate the word HELLO', expect: 'SpaceType' },
  ]
  for (const c of cases) {
    it(`"${c.phrase}" → ${c.expect}`, () => {
      const top = topN(c.phrase, 3)
      expect(top).toContain(c.expect)
      if (c.notFirst) expect(top[0]).toBe(c.expect)
    })
  }
})

// 7. buildCatalog integration — the ACTUAL discovery path the agent uses. Tests
//    that capabilities land in the assembled palette (intent-first, not truncated)
//    even on an IMAGE anchor (the original "remove background impossible" bug),
//    and that the frontend studios appear despite having no /object_info.
describe('buildCatalog assembles the right palette', () => {
  // What the agent feeds buildCatalog: studios (synthesized) + every capability
  // as a NodeTypeLite + raw distractors. objectInfo empty → ports fall back to lite.
  const capLite = AGENT_CAPABILITIES.map(c => ({ name: c.nodeType, displayName: c.title, description: c.summary, category: c.kind, inputs: c.inputs, outputs: c.outputs }))
  const rawLite = RAW.map(r => ({ ...r, inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'IMAGE', type: 'IMAGE' }] }))
  const nodeTypes = [...studioNodeTypes(), ...capLite, ...rawLite]
  const imageAnchor = { portType: 'IMAGE', direction: 'output' as const }

  function catalog(intent: string) {
    return buildCatalog(nodeTypes, {}, imageAnchor, { intent, keywords, boosts, maxNodes: 30, maxIntent: 24 }).map(e => e.type)
  }

  it('surfaces RemoveBackgroundNode for "remove the background" on an image (the original bug)', () => {
    expect(catalog('remove the background')).toContain('RemoveBackgroundNode')
  })
  it('surfaces the frontend studios despite no /object_info', () => {
    expect(catalog('make a gradient')).toContain('GradientStudio')
    expect(catalog('seamless tileable pattern')).toContain('TextureStudio')
    expect(catalog('apply a halftone shader')).toContain('ShaderStudio')
    expect(catalog('animate the title in 3d')).toContain('SpaceType')
  })
  it('surfaces generators for their intents on an image anchor', () => {
    expect(catalog('upscale this image')).toContain('UpscaleImageNode')
    expect(catalog('outpaint and extend the photo')).toContain('OutpaintImageNode')
    expect(catalog('turn this into a 3d model')).toContain('Generate3DNode')
    expect(catalog('make a product shot of this')).toContain('ProductShotNode')
  })
  it('surfaces BOTH capabilities of a multi-step request in the 60-node palette', () => {
    const cat60 = (intent: string) => buildCatalog(nodeTypes, {}, imageAnchor, { intent, keywords, boosts, maxNodes: 60, maxIntent: 24 }).map(e => e.type)
    const a = cat60('remove the background and upscale it')
    expect(a).toContain('RemoveBackgroundNode'); expect(a).toContain('UpscaleImageNode')
    const b = cat60('restore the old photo and fix the faces')
    expect(b).toContain('RestorePhotoNode'); expect(b).toContain('FixFacesNode')
  })
})
