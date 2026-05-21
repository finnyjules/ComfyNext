/**
 * Maps source workflow types/categories from workflow-templates.vercel.app
 * to our 9-category system defined in generators/categories.js
 */

// Source type/category → our category ID
const typeMap = {
  // image-generation
  'Text to Image': 'image-generation',
  'Text-to-Image': 'image-generation',
  'Image': 'image-generation',
  'Image Generation': 'image-generation',
  'Turbo': 'image-generation',
  'Anime': 'image-generation',
  'Character': 'image-generation',
  'Character Reference': 'image-generation',
  'Multiple Angles': 'image-generation',
  'Portrait': 'image-generation',

  // video-generation
  'Text to Video': 'video-generation',
  'Image to Video': 'video-generation',
  'Video': 'video-generation',
  'Video to Video': 'video-generation',
  'Video Edit': 'video-generation',
  'Video Extension': 'video-generation',
  'Frame Interpolation': 'video-generation',
  'FLF2V': 'video-generation',
  'Motion Control': 'video-generation',

  // audio
  'Audio': 'audio',
  'Audio Generation': 'audio',
  'Music': 'audio',
  'Text to Audio': 'audio',
  'Audio to Audio': 'audio',
  'Audio Editing': 'audio',
  'Voice Cloning': 'audio',
  'Text to Speech': 'audio',

  // 3d
  '3D': '3d',
  '3D Model': '3d',
  'Image to 3D': '3d',
  'Image to Model': '3d',
  'Text to Model': '3d',
  'Depth Map': '3d',
  'Normal Map': '3d',

  // upscaling
  'Image Upscale': 'upscaling',
  'Video Upscale': 'upscaling',
  'Image Enhancement': 'upscaling',

  // inpainting (editing)
  'Image Edit': 'inpainting',
  'Image to Image': 'inpainting',
  'Inpainting': 'inpainting',
  'Outpainting': 'inpainting',
  'Style Transfer': 'inpainting',
  'Relight': 'inpainting',
  'Replacement': 'inpainting',
  'Pose transfer': 'inpainting',
  'Style Reference': 'inpainting',

  // batch-processing
  'Fashion': 'batch-processing',
  'Product': 'batch-processing',
  'Brand': 'batch-processing',
  'Brand Design': 'batch-processing',
  'Layout Design': 'batch-processing',
  'Mockup': 'batch-processing',
  'Vector': 'batch-processing',
  'icon': 'batch-processing',

  // utility
  'ControlNet': 'utility',
  'Preprocessor': 'utility',
  'OpenPose': 'utility',
  'Canny': 'utility',
  'LLM': 'utility',
  'Layer Decompose': 'utility',
  'API': 'utility',
}

// Top-level category fallback (from listing page badge)
const topLevelFallback = {
  Image: 'image-generation',
  Audio: 'audio',
  Video: 'video-generation',
}

const categoryLabels = {
  'image-generation': 'Image Generation',
  'video-generation': 'Video Generation',
  audio: 'Audio',
  '3d': '3D',
  upscaling: 'Upscaling & Enhancement',
  inpainting: 'Inpainting & Editing',
  'lora-training': 'LoRA Training',
  'batch-processing': 'Batch Processing',
  utility: 'Utility / Helper',
}

/**
 * Map a source template to our category ID.
 * Tries: type field → detail categories → top-level badge → fallback
 */
export function mapToCategory(sourceType, sourceTopCategory, detailCategories = []) {
  // 1. Try the type field from listing page
  if (sourceType && typeMap[sourceType]) {
    return typeMap[sourceType]
  }

  // 2. Try detail page categories (first match wins)
  for (const cat of detailCategories) {
    if (typeMap[cat]) return typeMap[cat]
  }

  // 3. Fallback to top-level badge
  if (sourceTopCategory && topLevelFallback[sourceTopCategory]) {
    return topLevelFallback[sourceTopCategory]
  }

  return 'image-generation' // ultimate fallback
}

export function getCategoryLabel(categoryId) {
  return categoryLabels[categoryId] || categoryId
}

/**
 * Map source model names to normalized model names for our baseModels list
 */
const modelNormalization = {
  'Flux': 'FLUX.1 Dev',
  'Flux.1': 'FLUX.1 Dev',
  'Flux.2': 'FLUX.2',
  'Flux.2 Dev': 'FLUX.2 Dev',
  'Flux.2 Klein': 'FLUX.2 Klein',
  'FLUX.1': 'FLUX.1 Dev',
  'FLUX.1 Dev': 'FLUX.1 Dev',
  'FLUX.1 Schnell': 'FLUX.1 Schnell',
  'SDXL': 'SDXL',
  'SD 1.5': 'SD 1.5',
  'SD1.5': 'SD 1.5',
  'Stable Cascade': 'Stable Cascade',
  'Hunyuan': 'Hunyuan',
  'HunyuanVideo': 'HunyuanVideo',
  'Pixart': 'Pixart',
  'Playground v2.5': 'Playground v2.5',
}

export function mapToBaseModel(sourceModels = []) {
  if (!sourceModels.length) return 'FLUX.1 Dev' // default

  const first = sourceModels[0]
  // Check exact match first
  if (modelNormalization[first]) return modelNormalization[first]

  // Check prefix match
  for (const [key, value] of Object.entries(modelNormalization)) {
    if (first.toLowerCase().startsWith(key.toLowerCase())) return value
  }

  // Return as-is (new model name)
  return first
}

/**
 * Extract tags from detail categories (lowercase, for display)
 */
export function extractTags(detailCategories = [], sourceType = '') {
  const tags = new Set()

  for (const cat of detailCategories) {
    const tag = cat.toLowerCase().replace(/\s+/g, '-')
    tags.add(tag)
  }

  if (sourceType) {
    tags.add(sourceType.toLowerCase().replace(/\s+/g, '-'))
  }

  return [...tags].slice(0, 6)
}

/**
 * Extract techniques from detail categories
 */
const knownTechniques = [
  'ControlNet', 'IPAdapter', 'LoRA', 'Face Swap', 'Style Transfer',
  'img2img', 'Inpainting', 'Outpainting', 'Depth Map', 'Canny Edge',
  'Pose Estimation', 'Segmentation', 'Upscaling', 'AnimateDiff', 'SVD',
  'Prompt Weighting', 'Regional Prompting', 'ControlNet Depth',
  'ControlNet Lineart', 'Background Removal', 'OpenPose', 'Relight',
  'Layer Decompose', 'Voice Cloning', 'Frame Interpolation',
]

export function extractTechniques(detailCategories = []) {
  const techniques = []
  for (const cat of detailCategories) {
    const match = knownTechniques.find((t) => t.toLowerCase() === cat.toLowerCase())
    if (match) techniques.push(match)
  }
  // Always return at least 2
  if (techniques.length < 2) {
    const defaults = ['img2img', 'Prompt Weighting']
    for (const d of defaults) {
      if (!techniques.includes(d)) techniques.push(d)
      if (techniques.length >= 2) break
    }
  }
  return techniques.slice(0, 4)
}
