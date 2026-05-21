import { workflows, categories, baseModels } from './mock/index.js'
import { collections } from './collections.js'

export function getAllSlugs() {
  return workflows.map((w) => w.slug)
}

export function getWorkflowBySlug(slug) {
  return workflows.find((w) => w.slug === slug) ?? null
}

export function getWorkflowById(id) {
  return workflows.find((w) => w.id === id) ?? null
}

export function getWorkflows({ page = 1, limit = 24, sort = 'popular' } = {}) {
  const sorted = sortWorkflows([...workflows], sort)
  const start = (page - 1) * limit
  return {
    data: sorted.slice(start, start + limit),
    total: sorted.length,
    page,
    totalPages: Math.ceil(sorted.length / limit),
  }
}

export function getTrending(limit = 12) {
  // Trending = high runs relative to recency
  return [...workflows]
    .sort((a, b) => {
      const aDays = daysSince(a.createdAt)
      const bDays = daysSince(b.createdAt)
      const aVelocity = a.stats.runs / Math.max(aDays, 1)
      const bVelocity = b.stats.runs / Math.max(bDays, 1)
      return bVelocity - aVelocity
    })
    .slice(0, limit)
}

export function getPopular(limit = 12) {
  return [...workflows].sort((a, b) => b.stats.runs - a.stats.runs).slice(0, limit)
}

export function getNewest(limit = 12) {
  return [...workflows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit)
}

const PINNED_FEATURED_SLUGS = [
  'templates-qwen_multiangle',
  'api_kling_omni_edit_video',
  'templates-multiple_consistent_shots-nb_pro',
  'templates-fashion_shoot_vton',
  'templates-character_sheet',
]

export function getFeatured(limit = 8) {
  const pinned = PINNED_FEATURED_SLUGS
    .map((slug) => workflows.find((w) => w.slug === slug))
    .filter(Boolean)
  const rest = workflows.filter(
    (w) => (w.isFeatured || w.isStaffPick) && !PINNED_FEATURED_SLUGS.includes(w.slug)
  )
  return [...pinned, ...rest].slice(0, limit)
}

export function getStaffPicks(limit = 6) {
  return workflows.filter((w) => w.isStaffPick).slice(0, limit)
}

export function getByCategory(categoryId, { page = 1, limit = 24, sort = 'popular' } = {}) {
  const filtered = workflows.filter((w) => w.category === categoryId)
  const sorted = sortWorkflows(filtered, sort)
  const start = (page - 1) * limit
  return {
    data: sorted.slice(start, start + limit),
    total: filtered.length,
    page,
    totalPages: Math.ceil(filtered.length / limit),
  }
}

export function searchWorkflows(query = '', filters = {}, { page = 1, limit = 24, sort = 'relevance' } = {}) {
  let results = [...workflows]

  // Text search
  if (query) {
    const q = query.toLowerCase()
    results = results.filter(
      (w) =>
        w.title.toLowerCase().includes(q) ||
        w.shortDescription.toLowerCase().includes(q) ||
        w.tags.some((t) => t.toLowerCase().includes(q)) ||
        w.creator.displayName.toLowerCase().includes(q) ||
        w.baseModel.toLowerCase().includes(q) ||
        w.techniques.some((t) => t.toLowerCase().includes(q))
    )
  }

  // Apply filters
  if (filters.category?.length) {
    results = results.filter((w) => filters.category.includes(w.category))
  }
  if (filters.model?.length) {
    results = results.filter((w) => filters.model.includes(w.baseModel))
  }
  if (filters.difficulty) {
    results = results.filter((w) => w.difficulty === filters.difficulty)
  }
  if (filters.outputType?.length) {
    results = results.filter((w) => filters.outputType.includes(w.outputType))
  }
  if (filters.technique?.length) {
    results = results.filter((w) => filters.technique.some((t) => w.techniques.includes(t)))
  }

  // Sort
  const sorted = sort === 'relevance' && query
    ? results // Already sorted by match quality from filter
    : sortWorkflows(results, sort)

  const start = (page - 1) * limit
  return {
    data: sorted.slice(start, start + limit),
    total: sorted.length,
    page,
    totalPages: Math.ceil(sorted.length / limit),
  }
}

export function getAutocomplete(query) {
  if (!query || query.length < 2) return { workflows: [], categories: [], tags: [], creators: [], models: [] }

  const q = query.toLowerCase()

  const matchedWorkflows = workflows
    .filter((w) => w.title.toLowerCase().includes(q))
    .slice(0, 5)
    .map((w) => ({ id: w.id, title: w.title, slug: w.slug, thumbnailUrl: w.thumbnailUrl, creator: w.creator.displayName }))

  const matchedCategories = categories
    .filter((c) => c.label.toLowerCase().includes(q))
    .slice(0, 3)
    .map((c) => ({ id: c.id, label: c.label }))

  const allTags = [...new Set(workflows.flatMap((w) => w.tags))]
  const matchedTags = allTags
    .filter((t) => t.toLowerCase().includes(q))
    .slice(0, 5)

  const allCreators = [...new Map(workflows.map((w) => [w.creator.id, w.creator])).values()]
  const matchedCreators = allCreators
    .filter((c) => c.displayName.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q))
    .slice(0, 3)

  const matchedModels = baseModels
    .filter((m) => m.toLowerCase().includes(q))
    .slice(0, 3)

  return {
    workflows: matchedWorkflows,
    categories: matchedCategories,
    tags: matchedTags,
    creators: matchedCreators,
    models: matchedModels,
  }
}

export function getRelated(workflowId, category, creatorId, limit = 6) {
  const similar = workflows
    .filter((w) => w.id !== workflowId && w.category === category)
    .slice(0, limit)

  const byCreator = workflows
    .filter((w) => w.id !== workflowId && w.creator.id === creatorId)
    .slice(0, limit)

  const alsoRan = workflows
    .filter((w) => w.id !== workflowId && !similar.includes(w) && !byCreator.includes(w))
    .sort((a, b) => b.stats.runs - a.stats.runs)
    .slice(0, limit)

  return { similar, byCreator, alsoRan }
}

export function getFilterCounts(results) {
  const counts = {
    category: {},
    model: {},
    difficulty: {},
    outputType: {},
  }

  const source = results || workflows

  source.forEach((w) => {
    counts.category[w.category] = (counts.category[w.category] || 0) + 1
    counts.model[w.baseModel] = (counts.model[w.baseModel] || 0) + 1
    counts.difficulty[w.difficulty] = (counts.difficulty[w.difficulty] || 0) + 1
    counts.outputType[w.outputType] = (counts.outputType[w.outputType] || 0) + 1
  })

  return counts
}

export function getCommunityStats() {
  return {
    totalWorkflows: workflows.length,
    totalRuns: workflows.reduce((sum, w) => sum + w.stats.runs, 0),
    totalCreators: new Set(workflows.map((w) => w.creator.id)).size,
    totalFavorites: workflows.reduce((sum, w) => sum + w.stats.favorites, 0),
  }
}

export function getCollectionWorkflows(collectionId, limit = 10) {
  const collection = collections.find((c) => c.id === collectionId)
  if (!collection) return []

  const { categories: cats, tags: filterTags, techniques: filterTech } = collection.filters

  const scored = workflows
    .filter((w) => {
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
    .sort((a, b) => b.score - a.score || b.workflow.stats.runs - a.workflow.stats.runs)

  return scored.slice(0, limit).map((s) => s.workflow)
}

export function getCollectionCreators(collectionId, limit = 3) {
  const collection = collections.find((c) => c.id === collectionId)
  if (!collection) return []

  const { categories: cats, tags: filterTags, techniques: filterTech } = collection.filters

  // Find workflows matching this collection's filters
  const matchingWorkflows = workflows.filter((w) => {
    const catMatch = cats.includes(w.category)
    const tagMatch = w.tags.some((t) => filterTags.includes(t))
    const techMatch = w.techniques.some((t) => filterTech.includes(t))
    return catMatch || tagMatch || techMatch
  })

  // Prioritize collection-specific creators (cr_{collectionId}_1, etc.)
  const prefix = `cr_${collectionId}_`
  const dedicatedIds = [...new Set(
    matchingWorkflows
      .filter((w) => w.creator.id.startsWith(prefix))
      .map((w) => w.creator.id)
  )]

  if (dedicatedIds.length >= limit) return dedicatedIds.slice(0, limit)

  // Fill remaining slots with dynamic ranking
  const usedIds = new Set(dedicatedIds)
  const creatorStats = {}
  matchingWorkflows.forEach((w) => {
    if (usedIds.has(w.creator.id)) return
    if (!creatorStats[w.creator.id]) {
      creatorStats[w.creator.id] = { id: w.creator.id, count: 0, runs: 0 }
    }
    creatorStats[w.creator.id].count++
    creatorStats[w.creator.id].runs += w.stats.runs
  })

  const remaining = Object.values(creatorStats)
    .sort((a, b) => b.count - a.count || b.runs - a.runs)
    .slice(0, limit - dedicatedIds.length)
    .map((s) => s.id)

  return [...dedicatedIds, ...remaining]
}

// Helpers
function sortWorkflows(arr, sort) {
  switch (sort) {
    case 'featured':
      return arr.sort((a, b) => {
        const aFeat = (a.isFeatured || a.isStaffPick) ? 1 : 0
        const bFeat = (b.isFeatured || b.isStaffPick) ? 1 : 0
        if (bFeat !== aFeat) return bFeat - aFeat
        return b.stats.runs - a.stats.runs
      })
    case 'popular':
      return arr.sort((a, b) => b.stats.runs - a.stats.runs)
    case 'newest':
      return arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    case 'runs':
      return arr.sort((a, b) => b.stats.runs - a.stats.runs)
    case 'favorites':
      return arr.sort((a, b) => b.stats.favorites - a.stats.favorites)
    case 'trending':
      return arr.sort((a, b) => {
        const aVelocity = a.stats.runs / Math.max(daysSince(a.createdAt), 1)
        const bVelocity = b.stats.runs / Math.max(daysSince(b.createdAt), 1)
        return bVelocity - aVelocity
      })
    case 'alphabetical':
      return arr.sort((a, b) => a.title.localeCompare(b.title))
    default:
      return arr
  }
}

function daysSince(dateStr) {
  const date = new Date(dateStr)
  const now = new Date()
  return Math.floor((now - date) / (1000 * 60 * 60 * 24))
}
