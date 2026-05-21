import { faker } from '@faker-js/faker'
import { categories, baseModels, techniques, customNodes } from './categories.js'

// --- Domain-specific vocabulary for realistic ComfyUI workflow titles ---

const adjectives = [
  'Cinematic', 'Photorealistic', 'Hyper-Detailed', 'Stylized', 'Ultra-HD',
  'Dynamic', 'Ethereal', 'Dramatic', 'Vibrant', 'Minimal',
  'Professional', 'Advanced', 'Quick', 'Ultimate', 'Optimized',
  'Refined', 'Enhanced', 'Experimental', 'High-Fidelity', 'Seamless',
  'Adaptive', 'Precision', 'Multi-Pass', 'Fast', 'Premium',
  'Custom', 'Unified', 'Universal', 'Smart', 'Modular',
]

const subjects = [
  'Portrait', 'Landscape', 'Character', 'Product', 'Architecture',
  'Fashion', 'Interior', 'Food', 'Vehicle', 'Environment',
  'Face', 'Animal', 'Texture', 'Scene', 'Background',
  'Avatar', 'Logo', 'Icon', 'Banner', 'Thumbnail',
  'Headshot', 'Figure', 'Outfit', 'Weapon', 'Creature',
  'Cityscape', 'Nature', 'Space', 'Fantasy', 'Sci-Fi',
]

const actions = [
  'Generator', 'Enhancer', 'Transformer', 'Pipeline', 'Workflow',
  'Creator', 'Renderer', 'Upscaler', 'Restorer', 'Compositor',
  'Synthesizer', 'Blender', 'Mixer', 'Processor', 'Refiner',
  'Converter', 'Optimizer', 'Inpainter', 'Outpainter', 'Detailer',
]

const titlePatterns = [
  (adj, subj, act, v) => `${adj} ${subj} ${act} v${v}`,
  (adj, subj, act, v) => `${subj} ${act} — ${adj} Edition`,
  (adj, subj, act, v) => `${adj} ${subj} ${act}`,
  (_adj, subj, _act, _v, tech) => `${tech} ${subj} Workflow`,
  (_adj, subj, _act, _v, _tech, model) => `${model} ${subj} Pipeline`,
  (adj, subj, _act, v) => `${adj} ${subj} Studio v${v}`,
  (_adj, subj, act, _v, tech) => `${tech}-Powered ${subj} ${act}`,
  (adj, _subj, act, v, tech) => `${adj} ${tech} ${act} v${v}`,
  (adj, subj) => `${adj} ${subj} Master`,
  (_adj, subj, _act, _v, tech) => `${subj} ${tech} Express`,
  (adj, subj, _act, v) => `${adj} ${subj} Pro v${v}`,
  (_adj, subj, act) => `Auto ${subj} ${act}`,
  (adj, subj) => `${adj} ${subj} Toolkit`,
  (_adj, subj, _act, v, tech) => `${tech} ${subj} Suite v${v}`,
  (adj, subj) => `One-Click ${adj} ${subj}`,
]

// ComfyUI node types for graph generation
const nodeTypes = [
  { type: 'KSampler', label: 'KSampler', w: 180, h: 120 },
  { type: 'KSamplerAdvanced', label: 'KSampler (Advanced)', w: 200, h: 160 },
  { type: 'CLIPTextEncode', label: 'CLIP Text Encode', w: 200, h: 100 },
  { type: 'CheckpointLoaderSimple', label: 'Load Checkpoint', w: 220, h: 100 },
  { type: 'VAEDecode', label: 'VAE Decode', w: 160, h: 80 },
  { type: 'VAEEncode', label: 'VAE Encode', w: 160, h: 80 },
  { type: 'EmptyLatentImage', label: 'Empty Latent Image', w: 200, h: 100 },
  { type: 'LoraLoader', label: 'Load LoRA', w: 200, h: 100 },
  { type: 'ControlNetApply', label: 'Apply ControlNet', w: 200, h: 100 },
  { type: 'ControlNetLoader', label: 'Load ControlNet', w: 200, h: 80 },
  { type: 'ImageUpscaleWithModel', label: 'Upscale (Model)', w: 200, h: 100 },
  { type: 'SaveImage', label: 'Save Image', w: 160, h: 80 },
  { type: 'PreviewImage', label: 'Preview Image', w: 160, h: 80 },
  { type: 'LoadImage', label: 'Load Image', w: 180, h: 100 },
  { type: 'IPAdapterApply', label: 'Apply IPAdapter', w: 200, h: 120 },
  { type: 'CLIPSetLastLayer', label: 'CLIP Set Last Layer', w: 200, h: 80 },
  { type: 'ConditioningCombine', label: 'Conditioning Combine', w: 220, h: 80 },
  { type: 'ConditioningSetArea', label: 'Conditioning Set Area', w: 220, h: 100 },
  { type: 'LatentUpscale', label: 'Latent Upscale', w: 180, h: 80 },
  { type: 'LatentComposite', label: 'Latent Composite', w: 180, h: 100 },
  { type: 'ImageScale', label: 'Image Scale', w: 160, h: 80 },
  { type: 'ImageBlend', label: 'Image Blend', w: 160, h: 80 },
  { type: 'FaceDetailer', label: 'Face Detailer', w: 200, h: 140 },
  { type: 'UltimateSDUpscale', label: 'Ultimate SD Upscale', w: 220, h: 140 },
  { type: 'ImageCompositeMasked', label: 'Image Composite', w: 200, h: 100 },
  { type: 'MaskComposite', label: 'Mask Composite', w: 180, h: 80 },
  { type: 'CLIPVisionLoader', label: 'CLIP Vision Loader', w: 200, h: 80 },
  { type: 'StyleModelApply', label: 'Apply Style Model', w: 200, h: 100 },
  { type: 'UpscaleModelLoader', label: 'Load Upscale Model', w: 220, h: 80 },
]

const inputTypes = [
  'Text Prompt', 'Image + Text', 'Image Only', 'Batch Images',
  'Video', 'Depth Map + Text', 'Pose + Text', 'Sketch + Text',
]

const outputTypes = [
  'Single Image', 'Multiple Images', 'Image Grid', 'Upscaled Image',
  'Video', 'Image Sequence', 'Inpainted Image', 'Style-Transferred Image',
]

const tagPool = [
  'portrait', 'cinematic', 'photorealistic', 'anime', 'landscape',
  'abstract', 'concept-art', 'product', 'architecture', 'fashion',
  'stylized', 'hdr', 'macro', 'minimalist', 'surreal',
  'fantasy', 'sci-fi', 'noir', 'vintage', 'neon',
  'dreamy', 'dark', 'vibrant', 'pastel', 'monochrome',
  'controlnet', 'ipadapter', 'lora', 'upscale', 'inpaint',
  'face-fix', 'background-removal', 'style-transfer', 'img2img', 'txt2img',
  'batch', 'automation', 'fast', 'high-quality', 'experimental',
  'character', 'texture', 'environment', 'vehicle', 'food',
  'interior', 'animal', 'icon', 'logo', 'avatar',
]

const difficulties = ['Beginner', 'Intermediate', 'Advanced']

const licenses = ['MIT', 'Apache-2.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'GPL-3.0']

const checkpointFiles = [
  { name: 'v1-5-pruned-emaonly.safetensors', size: '4.2 GB' },
  { name: 'sd_xl_base_1.0.safetensors', size: '6.9 GB' },
  { name: 'sd_xl_refiner_1.0.safetensors', size: '6.1 GB' },
  { name: 'flux1-dev.safetensors', size: '23.8 GB' },
  { name: 'flux1-schnell.safetensors', size: '23.8 GB' },
  { name: 'dreamshaper_8.safetensors', size: '2.1 GB' },
  { name: 'realisticVision_v51.safetensors', size: '2.1 GB' },
  { name: 'juggernautXL_v9.safetensors', size: '6.9 GB' },
  { name: 'proteus_v0.4.safetensors', size: '6.9 GB' },
  { name: 'stable_cascade_stage_c.safetensors', size: '8.4 GB' },
  { name: 'hunyuan_dit_1.2.safetensors', size: '8.0 GB' },
  { name: 'pixart_sigma.safetensors', size: '2.5 GB' },
  { name: 'playground-v2.5.safetensors', size: '5.2 GB' },
]

const loraFiles = [
  { name: 'add_detail.safetensors', size: '144 MB' },
  { name: 'epiNoiseOffset_v2.safetensors', size: '36 MB' },
  { name: 'FilmVelvia3.safetensors', size: '144 MB' },
  { name: 'LCM_LoRA_Weights.safetensors', size: '68 MB' },
  { name: 'hairdetailer.safetensors', size: '18 MB' },
  { name: 'more_details.safetensors', size: '144 MB' },
  { name: 'skin_texture_style_v2.safetensors', size: '36 MB' },
  { name: 'cinematic_lighting.safetensors', size: '72 MB' },
]

const controlnetModels = [
  { name: 'control_v11p_sd15_canny.pth', size: '1.4 GB' },
  { name: 'control_v11f1p_sd15_depth.pth', size: '1.4 GB' },
  { name: 'control_v11p_sd15_openpose.pth', size: '1.4 GB' },
  { name: 'control_v11p_sd15_lineart.pth', size: '1.4 GB' },
  { name: 'diffusers_xl_canny_full.safetensors', size: '2.5 GB' },
  { name: 'diffusers_xl_depth_full.safetensors', size: '2.5 GB' },
]

const upscaleModels = [
  { name: '4x-UltraSharp.pth', size: '67 MB' },
  { name: 'RealESRGAN_x4plus.pth', size: '64 MB' },
  { name: '4x_NMKD-Siax_200k.pth', size: '67 MB' },
]

// Parameter templates by category
const parameterTemplates = [
  { name: 'CFG Scale', type: 'float', default: 7.5, min: 1, max: 30, description: 'Controls how closely the output follows the prompt' },
  { name: 'Steps', type: 'int', default: 20, min: 1, max: 100, description: 'Number of denoising steps' },
  { name: 'Denoise', type: 'float', default: 0.75, min: 0, max: 1, description: 'Denoising strength for img2img or inpainting' },
  { name: 'Width', type: 'int', default: 1024, min: 64, max: 4096, description: 'Output image width in pixels' },
  { name: 'Height', type: 'int', default: 1024, min: 64, max: 4096, description: 'Output image height in pixels' },
  { name: 'Seed', type: 'int', default: -1, min: -1, max: 2147483647, description: 'Random seed (-1 for random)' },
  { name: 'Sampler', type: 'select', default: 'euler_ancestral', options: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_sde', 'uni_pc'], description: 'Sampling algorithm' },
  { name: 'Scheduler', type: 'select', default: 'normal', options: ['normal', 'karras', 'exponential', 'sgm_uniform'], description: 'Noise scheduler' },
  { name: 'Batch Size', type: 'int', default: 1, min: 1, max: 16, description: 'Number of images to generate per batch' },
  { name: 'CLIP Skip', type: 'int', default: 1, min: 1, max: 12, description: 'Number of CLIP layers to skip' },
  { name: 'ControlNet Strength', type: 'float', default: 1.0, min: 0, max: 2, description: 'Strength of ControlNet conditioning' },
  { name: 'LoRA Weight', type: 'float', default: 0.8, min: 0, max: 2, description: 'LoRA model influence weight' },
  { name: 'IPAdapter Weight', type: 'float', default: 0.85, min: 0, max: 1.5, description: 'IPAdapter influence weight' },
  { name: 'Upscale Factor', type: 'float', default: 2.0, min: 1, max: 8, description: 'Image upscaling multiplier' },
  { name: 'Face Restore', type: 'boolean', default: true, description: 'Enable face restoration with CodeFormer' },
  { name: 'Tiling', type: 'boolean', default: false, description: 'Enable seamless tiling for textures' },
  { name: 'Negative Prompt Weight', type: 'float', default: 1.0, min: 0, max: 5, description: 'Negative conditioning strength' },
  { name: 'Guidance Scale', type: 'float', default: 3.5, min: 1, max: 20, description: 'FLUX guidance scale' },
]

const descriptionSections = [
  'overview', 'features', 'usage', 'tips', 'requirements',
]

function generateTitle(index) {
  const adj = faker.helpers.arrayElement(adjectives)
  const subj = faker.helpers.arrayElement(subjects)
  const act = faker.helpers.arrayElement(actions)
  const v = faker.number.int({ min: 1, max: 5 })
  const tech = faker.helpers.arrayElement(techniques)
  const model = faker.helpers.arrayElement(baseModels)
  const pattern = faker.helpers.arrayElement(titlePatterns)
  return pattern(adj, subj, act, v, tech, model)
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

function generateShortDescription(title, category, baseModel) {
  const templates = [
    `Generate stunning ${category} outputs using ${baseModel} with optimized settings.`,
    `A production-ready workflow for ${category} powered by ${baseModel}.`,
    `Quickly create high-quality ${category} results with minimal setup.`,
    `All-in-one ${category} pipeline featuring advanced techniques and ${baseModel}.`,
    `Professional ${category} workflow with carefully tuned parameters for ${baseModel}.`,
    `Streamlined ${category} generation with one-click setup and ${baseModel} support.`,
    `Create beautiful ${category} outputs effortlessly. Optimized for ${baseModel}.`,
    `Fast and reliable ${category} workflow built on ${baseModel} architecture.`,
  ]
  return faker.helpers.arrayElement(templates)
}

function generateDescription(title, categoryLabel, baseModel, techniqueList, nodeCount) {
  const featureItems = faker.helpers.arrayElements([
    'One-click generation with sensible defaults',
    'Fully customizable parameters for fine-tuning',
    'Optimized for speed without sacrificing quality',
    'Automatic face detection and enhancement',
    'Built-in upscaling pipeline',
    'Support for batch processing',
    'ControlNet integration for guided generation',
    'IPAdapter support for style reference',
    'LoRA compatibility for custom styles',
    'Negative prompt templates included',
    'Multiple output formats supported',
    'Memory-optimized for consumer GPUs',
    'Tiling support for seamless textures',
    'Regional prompting for composition control',
    'Automatic color correction and grading',
  ], { min: 3, max: 6 })

  const tips = faker.helpers.arrayElements([
    'Start with low CFG values (3-5) for more creative results',
    'Use the included negative prompt template for best quality',
    'Increase steps to 30+ for maximum detail',
    'Try different samplers to find your preferred style',
    'Use img2img mode for iterative refinement',
    'Enable face restore for portrait workflows',
    'Experiment with LoRA weights between 0.5-0.9',
    'Use ControlNet depth for consistent compositions',
    'Set batch size to 4 for quick comparisons',
    'Lower denoise strength for subtle variations',
  ], { min: 2, max: 4 })

  return `# ${title}

## Overview
A professional ${categoryLabel.toLowerCase()} workflow built on **${baseModel}**. This workflow uses ${nodeCount} nodes and integrates ${techniqueList.join(', ')} for optimal results.

## Features
${featureItems.map((f) => `- ${f}`).join('\n')}

## Usage
1. Load the workflow into ComfyUI
2. Adjust the parameters in the sidebar to match your needs
3. Enter your prompt in the text encode node
4. Click "Queue Prompt" to generate

## Tips
${tips.map((t) => `- ${t}`).join('\n')}

## Requirements
- ComfyUI latest version
- ${baseModel} checkpoint
- Minimum 8GB VRAM recommended
`
}

export function generateNodes(categoryId) {
  const count = faker.number.int({ min: 5, max: 15 })

  // Always include certain core nodes
  const coreNodeTypes = [
    nodeTypes.find((n) => n.type === 'CheckpointLoaderSimple'),
    nodeTypes.find((n) => n.type === 'CLIPTextEncode'),
    nodeTypes.find((n) => n.type === 'KSampler'),
    nodeTypes.find((n) => n.type === 'VAEDecode'),
    nodeTypes.find((n) => n.type === 'SaveImage'),
  ]

  // Add optional nodes based on category
  const optionalNodes = nodeTypes.filter(
    (n) => !coreNodeTypes.find((c) => c.type === n.type)
  )

  const selectedOptional = faker.helpers.arrayElements(
    optionalNodes,
    { min: Math.max(0, count - coreNodeTypes.length), max: count - coreNodeTypes.length }
  )

  const allSelected = [...coreNodeTypes, ...selectedOptional].slice(0, count)

  // Layout nodes in a flow pattern
  const nodes = allSelected.map((nodeDef, idx) => {
    const col = Math.floor(idx / 3)
    const row = idx % 3
    return {
      id: `n${idx + 1}`,
      type: nodeDef.type,
      label: nodeDef.label,
      x: 100 + col * 280 + faker.number.int({ min: -20, max: 20 }),
      y: 80 + row * 180 + faker.number.int({ min: -15, max: 15 }),
      width: nodeDef.w,
      height: nodeDef.h,
    }
  })

  return nodes
}

export function generateEdges(nodes) {
  const edges = []
  // Create a chain connecting most nodes sequentially
  for (let i = 0; i < nodes.length - 1; i++) {
    // Main chain
    if (i < nodes.length - 1) {
      edges.push({
        from: nodes[i].id,
        to: nodes[i + 1].id,
        fromOutput: 0,
        toInput: 0,
      })
    }
    // Add some branch connections (30% chance)
    if (i > 1 && faker.datatype.boolean(0.3)) {
      const targetIdx = faker.number.int({ min: i + 1, max: nodes.length - 1 })
      if (targetIdx !== i + 1) {
        edges.push({
          from: nodes[i].id,
          to: nodes[targetIdx].id,
          fromOutput: faker.number.int({ min: 0, max: 1 }),
          toInput: faker.number.int({ min: 0, max: 2 }),
        })
      }
    }
  }
  return edges
}

export function generateDependencies(baseModel, techniqueList) {
  const deps = []

  // Checkpoint
  const checkpoint = checkpointFiles.find((c) => {
    const modelLower = baseModel.toLowerCase()
    const nameLower = c.name.toLowerCase()
    if (modelLower.includes('flux')) return nameLower.includes('flux')
    if (modelLower.includes('sdxl')) return nameLower.includes('xl_base')
    if (modelLower.includes('sd 1.5')) return nameLower.includes('v1-5')
    if (modelLower.includes('cascade')) return nameLower.includes('cascade')
    if (modelLower.includes('hunyuan')) return nameLower.includes('hunyuan')
    if (modelLower.includes('pixart')) return nameLower.includes('pixart')
    if (modelLower.includes('playground')) return nameLower.includes('playground')
    return false
  }) || faker.helpers.arrayElement(checkpointFiles)

  deps.push({ name: checkpoint.name, type: 'checkpoint', size: checkpoint.size })

  // LoRA if used
  if (techniqueList.includes('LoRA')) {
    const lora = faker.helpers.arrayElement(loraFiles)
    deps.push({ name: lora.name, type: 'lora', size: lora.size })
  }

  // ControlNet if used
  if (techniqueList.some((t) => t.toLowerCase().includes('controlnet') || t.toLowerCase().includes('canny') || t.toLowerCase().includes('depth'))) {
    const cn = faker.helpers.arrayElement(controlnetModels)
    deps.push({ name: cn.name, type: 'controlnet', size: cn.size })
  }

  // Upscale model if techniques include upscaling
  if (techniqueList.includes('Upscaling')) {
    const up = faker.helpers.arrayElement(upscaleModels)
    deps.push({ name: up.name, type: 'upscale_model', size: up.size })
  }

  // Custom nodes
  const nodeCount = faker.number.int({ min: 1, max: 3 })
  const selectedNodes = faker.helpers.arrayElements(customNodes, { min: nodeCount, max: nodeCount })
  selectedNodes.forEach((cn) => {
    deps.push({
      name: cn,
      type: 'custom_node',
      version: `${faker.number.int({ min: 1, max: 8 })}.${faker.number.int({ min: 0, max: 9 })}.${faker.number.int({ min: 0, max: 9 })}`,
    })
  })

  return deps
}

export function generateVersions(createdAt) {
  const versionCount = faker.number.int({ min: 1, max: 4 })
  const versions = []
  const created = new Date(createdAt)

  const changelogOptions = [
    'Initial release',
    'Added ControlNet support',
    'Improved prompt handling',
    'Fixed VAE decode artifacts',
    'Added batch processing mode',
    'Performance optimization',
    'Updated for SDXL compatibility',
    'Added LoRA integration',
    'Improved face detection',
    'Added upscaling pipeline',
    'Fixed memory leak issue',
    'Updated node connections',
    'Added negative prompt template',
    'Improved color accuracy',
    'Added regional prompting support',
    'Updated for FLUX compatibility',
    'Reduced VRAM usage',
    'Added IPAdapter support',
  ]

  for (let i = versionCount; i >= 1; i--) {
    const daysAfterCreation = Math.floor(((versionCount - i) / versionCount) * 120)
    const versionDate = new Date(created.getTime() + daysAfterCreation * 24 * 60 * 60 * 1000)

    versions.push({
      version: `${i}.0`,
      date: versionDate.toISOString().split('T')[0],
      changelog: i === 1
        ? 'Initial release'
        : faker.helpers.arrayElement(changelogOptions.filter((c) => c !== 'Initial release')),
    })
  }

  return versions.reverse()
}

export function generateOutputImages(workflowId, count) {
  const captions = [
    'Example output with default settings',
    'High-quality result with optimized parameters',
    'Sample generation at 1024x1024',
    'Output with ControlNet guidance',
    'Result using custom LoRA weights',
    'Batch output comparison',
    'Before and after enhancement',
    'Style variation example',
    'Detailed close-up render',
    'Full scene composition',
    'Portrait with face restoration',
    'Landscape with HDR processing',
    'Product shot with studio lighting',
    'Character design output',
    'Texture sample at full resolution',
  ]

  return Array.from({ length: count }, (_, i) => ({
    url: `https://picsum.photos/seed/${workflowId}_${i}/800/600`,
    caption: faker.helpers.arrayElement(captions),
  }))
}

export function generateParameters() {
  const count = faker.number.int({ min: 3, max: 6 })
  return faker.helpers.arrayElements(parameterTemplates, { min: count, max: count })
}

export function generateWorkflows(count = 200) {
  faker.seed(42)

  const now = new Date('2026-01-15T00:00:00Z')
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const workflows = []
  const usedTitles = new Set()

  for (let i = 0; i < count; i++) {
    const id = `wf_${String(i + 1).padStart(4, '0')}`

    // Generate unique title
    let title = generateTitle(i)
    let attempts = 0
    while (usedTitles.has(title) && attempts < 20) {
      title = generateTitle(i)
      attempts++
    }
    usedTitles.add(title)

    const slug = slugify(title)

    // Pick category and subcategory
    const category = faker.helpers.arrayElement(categories)
    const subcategory = faker.helpers.arrayElement(category.subcategories)
    const baseModel = faker.helpers.arrayElement(baseModels)

    // Pick techniques (2-4)
    const workflowTechniques = faker.helpers.arrayElements(techniques, { min: 2, max: 4 })

    // Pick tags (3-6)
    const tags = faker.helpers.arrayElements(tagPool, { min: 3, max: 6 })

    // Pick difficulty
    const difficulty = faker.helpers.weightedArrayElement([
      { value: 'Beginner', weight: 3 },
      { value: 'Intermediate', weight: 5 },
      { value: 'Advanced', weight: 2 },
    ])

    // Creator reference
    const creatorIndex = faker.number.int({ min: 1, max: 50 })
    const creatorId = `cr_${String(creatorIndex).padStart(3, '0')}`

    // Dates
    const createdAt = faker.date.between({
      from: '2025-03-01T00:00:00Z',
      to: '2026-01-10T00:00:00Z',
    })
    const updatedAt = faker.date.between({
      from: createdAt,
      to: now,
    })

    // Flags
    const isNew = createdAt >= sevenDaysAgo || faker.datatype.boolean(0.18)
    const isUpdated = !isNew && faker.datatype.boolean(0.15)
    const isFeatured = faker.datatype.boolean(0.05)
    const isStaffPick = faker.datatype.boolean(0.03)

    // Stats — vary by "age" and random popularity
    const ageInDays = Math.max(1, Math.floor((now - createdAt) / (24 * 60 * 60 * 1000)))
    const popularityFactor = faker.number.float({ min: 0.2, max: 3.0 })

    const runs = Math.floor(ageInDays * popularityFactor * faker.number.int({ min: 10, max: 80 }))
    const favorites = Math.floor(runs * faker.number.float({ min: 0.03, max: 0.12 }))
    const forks = Math.floor(favorites * faker.number.float({ min: 0.05, max: 0.25 }))
    const comments = Math.floor(favorites * faker.number.float({ min: 0.02, max: 0.15 }))

    // Nodes and edges
    const nodes = generateNodes(category.id)
    const edges = generateEdges(nodes)

    // Output images
    const outputImageCount = faker.number.int({ min: 3, max: 5 })

    const inputType = faker.helpers.arrayElement(inputTypes)
    const outputType = faker.helpers.arrayElement(outputTypes)
    const estimatedTime = faker.helpers.weightedArrayElement([
      { value: faker.number.int({ min: 5, max: 15 }), weight: 4 },
      { value: faker.number.int({ min: 15, max: 45 }), weight: 4 },
      { value: faker.number.int({ min: 45, max: 120 }), weight: 2 },
    ])

    workflows.push({
      id,
      slug,
      title,
      shortDescription: generateShortDescription(title, category.label.toLowerCase(), baseModel),
      description: generateDescription(title, category.label, baseModel, workflowTechniques, nodes.length),
      creator: {
        id: creatorId,
        handle: `@creator_${creatorIndex}`,
        displayName: `Creator ${creatorIndex}`,
        avatarUrl: `https://i.pravatar.cc/150?u=${creatorId}`,
      },
      category: category.id,
      categoryLabel: category.label,
      subcategory,
      baseModel,
      tags,
      techniques: workflowTechniques,
      difficulty,
      inputType,
      outputType,
      estimatedTime,
      thumbnailUrl: `https://picsum.photos/seed/${id}/400/300`,
      outputImages: generateOutputImages(id, outputImageCount),

      stats: {
        runs,
        favorites,
        forks,
        comments,
      },
      parameters: generateParameters(),
      nodes,
      edges,
      dependencies: generateDependencies(baseModel, workflowTechniques),
      versions: generateVersions(createdAt.toISOString()),
      license: faker.helpers.arrayElement(licenses),
      isNew,
      isUpdated,
      isFeatured,
      isStaffPick,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    })
  }

  return workflows
}
