import { faker } from '@faker-js/faker'

const badgeOptions = [
  'verified',
  'staff-pick',
  'top-creator',
  'early-adopter',
  'prolific',
  'community-favorite',
  'rising-star',
]

const handlePrefixes = [
  'ai', 'pixel', 'neural', 'comfy', 'diffusion', 'stable', 'flux', 'prompt',
  'render', 'gen', 'dream', 'synth', 'deep', 'art', 'creative', 'flow',
  'node', 'graph', 'latent', 'vision', 'studio', 'craft', 'forge', 'lab',
]

const handleSuffixes = [
  'artist', 'maker', 'wizard', 'lab', 'studio', 'works', 'forge',
  'craft', 'pro', 'dev', 'hub', 'ops', 'smith', 'mind', 'fx',
]

const bioTemplates = [
  'Building AI art tools and sharing workflows. Specializing in {specialty}.',
  'ComfyUI enthusiast exploring {specialty}. Open-source contributor.',
  'Professional {specialty} artist leveraging AI. Sharing what I learn.',
  'Pushing the boundaries of {specialty} with ComfyUI. {extra}',
  'Full-time AI artist focused on {specialty}. Previously worked in {prev}.',
  'Researcher and creator exploring {specialty}. {extra}',
  'Generative art lover. Creating workflows for {specialty} and beyond.',
  'Workflow engineer specializing in {specialty}. {extra}',
  'Self-taught AI artist. Passionate about {specialty} and community building.',
  'Creative technologist blending {specialty} with cutting-edge AI tools.',
]

const specialties = [
  'portrait photography', 'concept art', 'product visualization',
  'architectural rendering', 'character design', 'landscape generation',
  'video synthesis', 'style transfer', 'image restoration',
  'LoRA training', 'ControlNet workflows', 'batch processing pipelines',
  'photorealistic rendering', 'anime illustration', 'abstract art',
  'texture generation', 'motion graphics', '3D asset creation',
]

const prevJobs = [
  'game development', 'visual effects', 'graphic design',
  'photography', 'film production', 'advertising',
  'fashion', 'architecture', 'illustration',
]

const extraBits = [
  'Over 10k runs on my workflows.',
  'Featured creator on ComfyHub.',
  'Community moderator.',
  'Tutorial creator and mentor.',
  'Open-source advocate.',
  'Building tools for creators.',
  'Weekly workflow drops.',
  'Formerly at a major game studio.',
]

const collectionNames = [
  'Portrait Essentials', 'Landscape Pack', 'Anime Starter Kit',
  'Product Photography Suite', 'Video Generation Toolkit', 'LoRA Training Helpers',
  'Quick Generators', 'Style Transfer Collection', 'Upscaling Pipeline Pack',
  'Concept Art Toolkit', 'Architecture Renders', 'Character Design Pack',
  'Texture Generator Suite', 'Batch Processing Kit', 'Inpainting Essentials',
  'Face Swap Tools', 'Background Removal Kit', 'Color Grading Pack',
  'Cinematic Workflows', 'Illustration Toolkit',
]

function generateHandle(index) {
  const prefix = faker.helpers.arrayElement(handlePrefixes)
  const suffix = faker.helpers.arrayElement(handleSuffixes)
  const separator = faker.helpers.arrayElement(['_', '.', '-', ''])
  const useNumber = faker.datatype.boolean(0.3)
  const base = `${prefix}${separator}${suffix}`
  return `@${base}${useNumber ? faker.number.int({ min: 1, max: 99 }) : ''}`
}

function generateBio() {
  const template = faker.helpers.arrayElement(bioTemplates)
  const specialty = faker.helpers.arrayElement(specialties)
  const prev = faker.helpers.arrayElement(prevJobs)
  const extra = faker.helpers.arrayElement(extraBits)
  return template
    .replace('{specialty}', specialty)
    .replace('{prev}', prev)
    .replace('{extra}', extra)
}

function generateDisplayName(handle) {
  const styles = [
    () => {
      const parts = handle.replace('@', '').split(/[_.\-]/)
      return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
    },
    () => faker.person.fullName(),
    () => {
      const adj = faker.helpers.arrayElement([
        'Digital', 'Pixel', 'Neural', 'Creative', 'Stable',
        'Quantum', 'Cosmic', 'Electric', 'Neon', 'Hyper',
      ])
      const noun = faker.helpers.arrayElement([
        'Artist', 'Studio', 'Labs', 'Works', 'Forge',
        'Dreams', 'Visions', 'Craft', 'Renders', 'Pixels',
      ])
      return `${adj} ${noun}`
    },
  ]
  return faker.helpers.arrayElement(styles)()
}

function generateCollections(creatorId, index) {
  const count = faker.number.int({ min: 0, max: 3 })
  const collections = []
  const usedNames = new Set()

  for (let i = 0; i < count; i++) {
    let name = faker.helpers.arrayElement(collectionNames)
    while (usedNames.has(name)) {
      name = faker.helpers.arrayElement(collectionNames)
    }
    usedNames.add(name)

    collections.push({
      id: `col_${String(index).padStart(3, '0')}_${i + 1}`,
      name,
      description: faker.lorem.sentence({ min: 6, max: 12 }),
      workflowIds: [],
      coverUrl: `https://picsum.photos/seed/col_${creatorId}_${i}/600/400`,
    })
  }

  return collections
}

function generateSocialLinks() {
  const links = {}
  if (faker.datatype.boolean(0.7)) {
    links.twitter = `https://x.com/${faker.internet.username().toLowerCase()}`
  }
  if (faker.datatype.boolean(0.5)) {
    links.github = `https://github.com/${faker.internet.username().toLowerCase()}`
  }
  if (faker.datatype.boolean(0.4)) {
    links.website = faker.internet.url()
  }
  return links
}

function generateBadges(index) {
  const badges = []

  // Top creators (first 10) always get verified
  if (index < 10) {
    badges.push('verified')
  } else if (faker.datatype.boolean(0.3)) {
    badges.push('verified')
  }

  // Additional badges
  const remaining = badgeOptions.filter((b) => !badges.includes(b))
  const extraCount = faker.number.int({ min: 0, max: 2 })
  for (let i = 0; i < extraCount; i++) {
    if (remaining.length > 0) {
      const badge = faker.helpers.arrayElement(remaining)
      badges.push(badge)
      remaining.splice(remaining.indexOf(badge), 1)
    }
  }

  return badges
}

export function generateCreators(count = 50) {
  faker.seed(42)

  const creators = []
  const usedHandles = new Set()

  for (let i = 0; i < count; i++) {
    const id = `cr_${String(i + 1).padStart(3, '0')}`

    let handle = generateHandle(i)
    while (usedHandles.has(handle)) {
      handle = generateHandle(i)
    }
    usedHandles.add(handle)

    const displayName = generateDisplayName(handle)

    // Higher stats for lower-indexed creators (top creators)
    const tier = i < 5 ? 'top' : i < 15 ? 'mid' : 'regular'
    const statsRanges = {
      top: {
        workflowCount: [25, 60],
        totalRuns: [80000, 250000],
        totalFavorites: [5000, 20000],
        totalForks: [800, 3000],
        followers: [2000, 10000],
        following: [50, 300],
      },
      mid: {
        workflowCount: [10, 30],
        totalRuns: [20000, 100000],
        totalFavorites: [1000, 8000],
        totalForks: [200, 1200],
        followers: [500, 3000],
        following: [80, 400],
      },
      regular: {
        workflowCount: [2, 15],
        totalRuns: [500, 30000],
        totalFavorites: [50, 2000],
        totalForks: [10, 400],
        followers: [20, 800],
        following: [30, 250],
      },
    }

    const r = statsRanges[tier]

    const joinedAt = faker.date.between({
      from: '2024-01-01T00:00:00Z',
      to: '2025-10-01T00:00:00Z',
    })

    creators.push({
      id,
      handle,
      displayName,
      bio: generateBio(),
      avatarUrl: `https://i.pravatar.cc/150?u=${id}`,
      bannerUrl: `https://picsum.photos/seed/banner_${id}/1200/300`,
      badges: generateBadges(i),
      stats: {
        workflowCount: faker.number.int({ min: r.workflowCount[0], max: r.workflowCount[1] }),
        totalRuns: faker.number.int({ min: r.totalRuns[0], max: r.totalRuns[1] }),
        totalFavorites: faker.number.int({ min: r.totalFavorites[0], max: r.totalFavorites[1] }),
        totalForks: faker.number.int({ min: r.totalForks[0], max: r.totalForks[1] }),
        followers: faker.number.int({ min: r.followers[0], max: r.followers[1] }),
        following: faker.number.int({ min: r.following[0], max: r.following[1] }),
      },
      pinnedWorkflowIds: [],
      collections: generateCollections(id, i + 1),
      socialLinks: generateSocialLinks(),
      joinedAt: joinedAt.toISOString(),
    })
  }

  return creators
}
