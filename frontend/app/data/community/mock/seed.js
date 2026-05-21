import { transformedWorkflows } from '../scraped/transform.js'
import { generateCreators } from './generators/creators.js'
import { generateComments } from './generators/comments.js'
import { categories, baseModels, techniques } from './generators/categories.js'
import { collections } from '../collections.js'

const rawWorkflows = transformedWorkflows
const creators = generateCreators(50)

// Add the ComfyUI official creator (referenced by scraped workflows)
if (!creators.find((c) => c.handle === '@comfyui')) {
  creators.push({
    id: 'cr_comfyui',
    handle: '@comfyui',
    displayName: 'ComfyUI',
    bio: 'The official ComfyUI account. Sharing templates, workflows, and best practices for the ComfyUI community.',
    avatarUrl: 'https://preview.redd.it/new-comfyui-logo-icon-v0-c05cowjywfze1.png?width=640&crop=smart&auto=webp&s=d381ee8ada0a2b993684c9ef26daf744c43350e2',
    bannerUrl: 'https://picsum.photos/seed/banner_comfyui/1200/300',
    badges: ['verified', 'staff-pick'],
    stats: {
      workflowCount: 0,
      totalRuns: 500000,
      totalFavorites: 30000,
      totalForks: 5000,
      followers: 25000,
      following: 0,
    },
    pinnedWorkflowIds: [],
    collections: [],
    socialLinks: {
      twitter: 'https://x.com/comaborat',
      github: 'https://github.com/comfyanonymous/ComfyUI',
      website: 'https://www.comfy.org',
    },
    joinedAt: '2024-01-01T00:00:00Z',
  })
}

// Scraped creators from X/Twitter
const scrapedCreators = [
  {
    id: 'cr_hellorob',
    handle: '@hellorob',
    displayName: 'rob - comfyui',
    bio: 'ComfyUI workflow creator sharing free workflows and tutorials. Fixing AI-generated skin, testing new models, and building one-click solutions for the community.',
    avatarUrl: 'https://pbs.twimg.com/profile_images/1886131820737011712/IQ3fYbzA_400x400.jpg',
    bannerUrl: 'https://picsum.photos/seed/banner_hellorob/1200/300',
    badges: ['verified', 'top-creator'],
    stats: {
      workflowCount: 0,
      totalRuns: 180000,
      totalFavorites: 12000,
      totalForks: 2800,
      followers: 3844,
      following: 210,
    },
    pinnedWorkflowIds: [],
    collections: [],
    socialLinks: {
      twitter: 'https://x.com/hellorob',
    },
    joinedAt: '2023-02-15T00:00:00Z',
  },
  {
    id: 'cr_purzbeats',
    handle: '@PurzBeats',
    displayName: 'Purz.ai',
    bio: 'Creative exploration with ComfyUI and Blender. Live streams, tutorials, and workflow drops. Building the bridge between 3D and AI generation.',
    avatarUrl: 'https://pbs.twimg.com/profile_images/1590795790146015238/bHAco6jp_400x400.jpg',
    bannerUrl: 'https://picsum.photos/seed/banner_purzbeats/1200/300',
    badges: ['verified', 'community-favorite'],
    stats: {
      workflowCount: 0,
      totalRuns: 95000,
      totalFavorites: 7500,
      totalForks: 1600,
      followers: 5200,
      following: 340,
    },
    pinnedWorkflowIds: [],
    collections: [],
    socialLinks: {
      twitter: 'https://x.com/PurzBeats',
      website: 'https://purz.ai',
    },
    joinedAt: '2023-06-01T00:00:00Z',
  },
  {
    id: 'cr_8bit_e',
    handle: '@8bit_e',
    displayName: 'enigmatic_e',
    bio: 'AI artist blending ComfyUI, Viggle, and After Effects. Experimenting with Wan, Flux Kontext, and 3D models. Understanding tools builds confidence to create.',
    avatarUrl: 'https://pbs.twimg.com/profile_images/1122002553057599488/2J9M3WmW_400x400.jpg',
    bannerUrl: 'https://picsum.photos/seed/banner_8bit_e/1200/300',
    badges: ['verified', 'rising-star'],
    stats: {
      workflowCount: 0,
      totalRuns: 62000,
      totalFavorites: 4200,
      totalForks: 900,
      followers: 2100,
      following: 180,
    },
    pinnedWorkflowIds: [],
    collections: [],
    socialLinks: {
      twitter: 'https://x.com/8bit_e',
    },
    joinedAt: '2023-10-20T00:00:00Z',
  },
]

scrapedCreators.forEach((sc) => {
  if (!creators.find((c) => c.handle === sc.handle)) {
    creators.push(sc)
  }
})

// Collection-specific featured creators (3 per collection)
const collectionCreators = [
  // Marketing
  {
    id: 'cr_marketing_1', handle: '@BrandVisuals', displayName: 'Brand Visuals Studio',
    bio: 'Creating scroll-stopping ad creatives and social media visuals with ComfyUI. Specializing in product mockups and brand-consistent content at scale.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_marketing_1', bannerUrl: 'https://picsum.photos/seed/banner_cr_marketing_1/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 112000, totalFavorites: 8400, totalForks: 1900, followers: 4200, following: 150 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/brandvisuals' }, joinedAt: '2024-02-10T00:00:00Z',
  },
  {
    id: 'cr_marketing_2', handle: '@AdCreativeAI', displayName: 'Sarah Chen',
    bio: 'Marketing director turned AI creator. Using ComfyUI to generate campaign assets, A/B test visuals, and produce branded content 10x faster.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_marketing_2', bannerUrl: 'https://picsum.photos/seed/banner_cr_marketing_2/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 87000, totalFavorites: 6100, totalForks: 1400, followers: 3100, following: 220 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/adcreativeai' }, joinedAt: '2024-04-18T00:00:00Z',
  },
  {
    id: 'cr_marketing_3', handle: '@SocialGenPro', displayName: 'Marcus Rivera',
    bio: 'Building ComfyUI workflows for social media managers. Batch-generating Instagram carousels, story templates, and ad variations in minutes.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_marketing_3', bannerUrl: 'https://picsum.photos/seed/banner_cr_marketing_3/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 64000, totalFavorites: 4800, totalForks: 1100, followers: 2400, following: 180 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/socialgenpro' }, joinedAt: '2024-06-05T00:00:00Z',
  },
  // VFX
  {
    id: 'cr_vfx_1', handle: '@VFXNodePro', displayName: 'Jake Morrison',
    bio: 'VFX supervisor using ComfyUI for compositing, rotoscoping, and motion graphics. 15 years in film, now bridging traditional VFX with AI.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_vfx_1', bannerUrl: 'https://picsum.photos/seed/banner_cr_vfx_1/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 118000, totalFavorites: 9200, totalForks: 2100, followers: 4800, following: 130 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/vfxnodepro' }, joinedAt: '2024-01-22T00:00:00Z',
  },
  {
    id: 'cr_vfx_2', handle: '@PostProdAI', displayName: 'Nova Effects',
    bio: 'Boutique post-production studio automating VFX workflows with ComfyUI. Frame interpolation, style transfer, and cinematic color grading pipelines.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_vfx_2', bannerUrl: 'https://picsum.photos/seed/banner_cr_vfx_2/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 91000, totalFavorites: 6800, totalForks: 1500, followers: 3500, following: 200 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/postprodai' }, joinedAt: '2024-03-14T00:00:00Z',
  },
  {
    id: 'cr_vfx_3', handle: '@MotionSynth', displayName: 'Elara Kim',
    bio: 'Motion designer crafting ComfyUI pipelines for video effects, transitions, and animated overlays. Blending After Effects with AI generation.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_vfx_3', bannerUrl: 'https://picsum.photos/seed/banner_cr_vfx_3/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 72000, totalFavorites: 5100, totalForks: 1200, followers: 2700, following: 190 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/motionsynth' }, joinedAt: '2024-05-28T00:00:00Z',
  },
  // Architecture
  {
    id: 'cr_architecture_1', handle: '@ArchRenders', displayName: 'Render Architects',
    bio: 'Architectural visualization studio using ComfyUI for concept renders, material studies, and client presentations from 3D models and sketches.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_architecture_1', bannerUrl: 'https://picsum.photos/seed/banner_cr_architecture_1/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 105000, totalFavorites: 7800, totalForks: 1800, followers: 4100, following: 140 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/archrenders' }, joinedAt: '2024-02-28T00:00:00Z',
  },
  {
    id: 'cr_architecture_2', handle: '@AIBuildViz', displayName: 'Thomas Bergmann',
    bio: 'Licensed architect exploring AI-assisted design visualization. Converting SketchUp models to photorealistic renders with ComfyUI and ControlNet.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_architecture_2', bannerUrl: 'https://picsum.photos/seed/banner_cr_architecture_2/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 78000, totalFavorites: 5600, totalForks: 1300, followers: 2900, following: 210 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/aibuildviz' }, joinedAt: '2024-04-10T00:00:00Z',
  },
  {
    id: 'cr_architecture_3', handle: '@SpaceDesignAI', displayName: 'Priya Patel',
    bio: 'Interior and spatial designer using ComfyUI to generate room concepts, lighting studies, and mood boards from floor plans and reference images.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_architecture_3', bannerUrl: 'https://picsum.photos/seed/banner_cr_architecture_3/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 56000, totalFavorites: 4200, totalForks: 950, followers: 2100, following: 170 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/spacedesignai' }, joinedAt: '2024-07-15T00:00:00Z',
  },
  // Animation
  {
    id: 'cr_animation_1', handle: '@AnimFlowAI', displayName: 'Pixel Motion Lab',
    bio: 'Animation studio building ComfyUI workflows for text-to-video, character animation, and frame interpolation. Making AI animation accessible.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_animation_1', bannerUrl: 'https://picsum.photos/seed/banner_cr_animation_1/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 98000, totalFavorites: 7400, totalForks: 1700, followers: 3900, following: 160 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/animflowai' }, joinedAt: '2024-03-05T00:00:00Z',
  },
  {
    id: 'cr_animation_2', handle: '@ToonForge', displayName: 'Danny Nguyen',
    bio: '2D animator using ComfyUI with AnimateDiff and SVD for short-form animation. Creating looping animations, character motion, and animated stickers.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_animation_2', bannerUrl: 'https://picsum.photos/seed/banner_cr_animation_2/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 81000, totalFavorites: 5900, totalForks: 1300, followers: 3200, following: 230 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/toonforge' }, joinedAt: '2024-05-12T00:00:00Z',
  },
  {
    id: 'cr_animation_3', handle: '@MotionCraft', displayName: 'Zoe Williams',
    bio: 'Stop-motion artist turned AI animator. Using ComfyUI to blend traditional animation principles with AI-generated motion and interpolation.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_animation_3', bannerUrl: 'https://picsum.photos/seed/banner_cr_animation_3/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 53000, totalFavorites: 3800, totalForks: 850, followers: 1900, following: 200 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/motioncraftai' }, joinedAt: '2024-08-01T00:00:00Z',
  },
  // Gaming
  {
    id: 'cr_gaming_1', handle: '@GameAssetAI', displayName: 'Forge Studios',
    bio: 'Indie game studio using ComfyUI to generate characters, environments, textures, and concept art. Shipping games faster with AI-assisted asset pipelines.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_gaming_1', bannerUrl: 'https://picsum.photos/seed/banner_cr_gaming_1/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 107000, totalFavorites: 8100, totalForks: 1850, followers: 4300, following: 145 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/gameassetai' }, joinedAt: '2024-01-30T00:00:00Z',
  },
  {
    id: 'cr_gaming_2', handle: '@PixelSmithAI', displayName: 'Ryan Okazaki',
    bio: 'Game artist building ComfyUI workflows for texture generation, sprite sheets, and tileable patterns. Specializing in stylized and pixel art aesthetics.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_gaming_2', bannerUrl: 'https://picsum.photos/seed/banner_cr_gaming_2/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 74000, totalFavorites: 5300, totalForks: 1200, followers: 2800, following: 195 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/pixelsmithai' }, joinedAt: '2024-04-22T00:00:00Z',
  },
  {
    id: 'cr_gaming_3', handle: '@LevelGenPro', displayName: 'Alex Volkov',
    bio: 'Technical artist creating ComfyUI pipelines for procedural environment art, skyboxes, and terrain textures for Unreal Engine and Unity projects.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_gaming_3', bannerUrl: 'https://picsum.photos/seed/banner_cr_gaming_3/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 61000, totalFavorites: 4500, totalForks: 1050, followers: 2300, following: 175 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/levelgenpro' }, joinedAt: '2024-06-18T00:00:00Z',
  },
  // 3D
  {
    id: 'cr_3d_1', handle: '@3DNodeLab', displayName: 'Vertex Labs',
    bio: '3D generalist studio using ComfyUI for image-to-3D, depth maps, normal maps, and mesh generation. Bridging 2D AI with 3D production pipelines.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_3d_1', bannerUrl: 'https://picsum.photos/seed/banner_cr_3d_1/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 95000, totalFavorites: 7100, totalForks: 1600, followers: 3700, following: 155 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/3dnodelab' }, joinedAt: '2024-02-20T00:00:00Z',
  },
  {
    id: 'cr_3d_2', handle: '@DepthCraft', displayName: 'Mira Santos',
    bio: '3D artist specializing in ComfyUI depth and normal map workflows. Creating 3D-ready assets from 2D references for Blender and ZBrush.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_3d_2', bannerUrl: 'https://picsum.photos/seed/banner_cr_3d_2/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 69000, totalFavorites: 5000, totalForks: 1150, followers: 2600, following: 185 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/depthcraft' }, joinedAt: '2024-05-05T00:00:00Z',
  },
  {
    id: 'cr_3d_3', handle: '@MeshGenAI', displayName: 'Oliver Grant',
    bio: 'Building ComfyUI workflows for 3D asset creation — from concept sketches to textured meshes. Focused on game-ready and print-ready 3D models.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_3d_3', bannerUrl: 'https://picsum.photos/seed/banner_cr_3d_3/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 48000, totalFavorites: 3500, totalForks: 800, followers: 1800, following: 210 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/meshgenai' }, joinedAt: '2024-07-28T00:00:00Z',
  },
  // Fashion
  {
    id: 'cr_fashion_1', handle: '@StyleGenAI', displayName: 'Maison Digital',
    bio: 'Digital fashion house using ComfyUI for virtual try-on, lookbook generation, and style transfer. Bringing AI to fashion design and e-commerce.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_fashion_1', bannerUrl: 'https://picsum.photos/seed/banner_cr_fashion_1/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 102000, totalFavorites: 7600, totalForks: 1750, followers: 4000, following: 135 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/stylegenai' }, joinedAt: '2024-03-18T00:00:00Z',
  },
  {
    id: 'cr_fashion_2', handle: '@RunwayNodeAI', displayName: 'Isabella Rossi',
    bio: 'Fashion designer using ComfyUI to prototype collections, generate outfit variations, and create virtual fitting room experiences with AI.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_fashion_2', bannerUrl: 'https://picsum.photos/seed/banner_cr_fashion_2/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 83000, totalFavorites: 6200, totalForks: 1400, followers: 3300, following: 205 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/runwaynodeai' }, joinedAt: '2024-05-22T00:00:00Z',
  },
  {
    id: 'cr_fashion_3', handle: '@FashionLensAI', displayName: 'Kai Tanaka',
    bio: 'Fashion photographer building ComfyUI workflows for editorial shoots, product photography, and model compositing. AI-enhanced fashion imagery.',
    avatarUrl: 'https://i.pravatar.cc/150?u=cr_fashion_3', bannerUrl: 'https://picsum.photos/seed/banner_cr_fashion_3/1200/300',
    badges: ['verified'], stats: { workflowCount: 0, totalRuns: 58000, totalFavorites: 4300, totalForks: 980, followers: 2200, following: 165 },
    pinnedWorkflowIds: [], collections: [], socialLinks: { twitter: 'https://x.com/fashionlensai' }, joinedAt: '2024-08-10T00:00:00Z',
  },
]

collectionCreators.forEach((cc) => {
  if (!creators.find((c) => c.handle === cc.handle)) {
    creators.push(cc)
  }
})

// Randomly assign some existing workflows to the scraped creators
// Uses a simple seeded shuffle so assignments are stable across builds
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

const rand = seededRandom(12345)
const scrapedCreatorIds = scrapedCreators.map((c) => c.id)

// Build a Set of workflow IDs to reassign (take from any creator except the scraped ones themselves)
const reassignableWorkflows = rawWorkflows.filter(
  (w) => !scrapedCreatorIds.includes(w.creator.id)
)
const shuffled = [...reassignableWorkflows].sort(() => rand() - 0.5)
const toReassignIds = new Set(shuffled.slice(0, 30).map((w) => w.id))

// Build the final workflows array with reassignments baked in
let reassignIndex = 0
const workflows = rawWorkflows.map((w) => {
  if (toReassignIds.has(w.id)) {
    const newCreator = scrapedCreators[reassignIndex % scrapedCreators.length]
    reassignIndex++
    return {
      ...w,
      creator: {
        id: newCreator.id,
        handle: newCreator.handle,
        displayName: newCreator.displayName,
        avatarUrl: newCreator.avatarUrl,
      },
    }
  }
  return w
})

// Reassign matching workflows to collection-specific creators
// For each collection, find workflows that match its filters and assign them
// to the 3 dedicated creators for that collection
const collectionCreatorIds = new Set(collectionCreators.map((c) => c.id))
const protectedIds = new Set([...scrapedCreatorIds, ...collectionCreatorIds])
const rand2 = seededRandom(67890)

collections.forEach((collection) => {
  const { categories: cats, tags: filterTags, techniques: filterTech } = collection.filters
  const creatorsForCollection = collectionCreators.filter((c) => c.id.startsWith(`cr_${collection.id}_`))
  if (creatorsForCollection.length === 0) return

  // Find workflows matching this collection's filters that aren't already assigned to protected creators
  const matching = workflows
    .filter((w) => {
      if (protectedIds.has(w.creator.id)) return false
      const catMatch = cats.includes(w.category)
      const tagMatch = w.tags.some((t) => filterTags.includes(t))
      const techMatch = w.techniques.some((t) => filterTech.includes(t))
      return catMatch || tagMatch || techMatch
    })
    .map((w) => {
      let score = 0
      if (cats.includes(w.category)) score += 2
      score += w.tags.filter((t) => filterTags.includes(t)).length
      score += w.techniques.filter((t) => filterTech.includes(t)).length
      return { workflow: w, score }
    })
    .sort((a, b) => b.score - a.score || rand2() - 0.5)

  // Take up to 9 best-matching workflows (3 per creator)
  const toAssign = matching.slice(0, 9)
  toAssign.forEach(({ workflow }, i) => {
    const creator = creatorsForCollection[i % creatorsForCollection.length]
    workflow.creator = {
      id: creator.id,
      handle: creator.handle,
      displayName: creator.displayName,
      avatarUrl: creator.avatarUrl,
    }
  })
})

// Link creators to their workflows
creators.forEach((creator) => {
  const creatorWorkflows = workflows.filter((w) => w.creator.id === creator.id)
  creator.stats.workflowCount = creatorWorkflows.length
  creator.pinnedWorkflowIds = creatorWorkflows.slice(0, Math.min(3, creatorWorkflows.length)).map((w) => w.id)

  // Build collections from creator's workflows
  if (creatorWorkflows.length >= 3) {
    const grouped = {}
    creatorWorkflows.forEach((w) => {
      if (!grouped[w.category]) grouped[w.category] = []
      grouped[w.category].push(w.id)
    })
    creator.collections = Object.entries(grouped)
      .filter(([, ids]) => ids.length >= 2)
      .slice(0, 3)
      .map(([catId, ids], i) => ({
        id: `col_${creator.id}_${i}`,
        name: `${categories.find((c) => c.id === catId)?.label ?? catId} Collection`,
        description: `A curated collection of ${ids.length} workflows`,
        workflowIds: ids,
        coverUrl: `https://picsum.photos/seed/col_${creator.id}_${i}/400/300`,
      }))
  }
})

const workflowIds = workflows.map((w) => w.id)
const comments = generateComments(500, workflowIds)

// Update comment counts on workflows
workflows.forEach((w) => {
  w.stats.comments = comments.filter((c) => c.workflowId === w.id).length
})

export { workflows, creators, comments, categories, baseModels, techniques }
