import { describe, it } from 'vitest'
import { AGENT_CAPABILITIES, capabilityBoosts, capabilityKeywords } from '~/lib/agent/capabilities'
import { searchNodes } from '~/lib/nodeMatch'
import { NODE_BOOST, NODE_KEYWORDS } from '~/lib/nodeKeywords'

const CAP_NODES = AGENT_CAPABILITIES.map(c => ({ name: c.nodeType, displayName: c.title, description: c.summary, category: c.kind }))
const RAW: any[] = [
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
const ALL = [...CAP_NODES, ...RAW]
const keywords = { ...NODE_KEYWORDS, ...capabilityKeywords() }
const boosts = { ...NODE_BOOST, ...capabilityBoosts() }

describe('probe3', () => {
  it('detail', () => {
    const fs = require('node:fs')
    const phrases = ['blue to purple gradient background', 'change the background color', 'change the color of the background', 'make the background a different color']
    const out = phrases.map(p => `${p} => ${JSON.stringify(searchNodes(ALL, p, { keywords, boosts, limit: 5 }).map(x => x.name))}`)
    fs.writeFileSync('/tmp/probe3.txt', out.join('\n'))
  })
})
