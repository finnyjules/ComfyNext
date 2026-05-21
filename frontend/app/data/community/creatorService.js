import { creators, workflows } from './mock/index.js'

export function getAllHandles() {
  return creators.map((c) => c.handle.replace('@', ''))
}

export function getCreator(handle) {
  const normalized = handle.startsWith('@') ? handle : `@${handle}`
  return creators.find((c) => c.handle === normalized) ?? null
}

export function getCreatorById(id) {
  return creators.find((c) => c.id === id) ?? null
}

export function getFeaturedCreators(limit = 8) {
  return [...creators]
    .sort((a, b) => b.stats.totalRuns - a.stats.totalRuns)
    .slice(0, limit)
}

export function getCreatorWorkflows(creatorId, { page = 1, limit = 24, sort = 'popular', category = null } = {}) {
  let results = workflows.filter((w) => w.creator.id === creatorId)

  if (category) {
    results = results.filter((w) => w.category === category)
  }

  const sorted = sortCreatorWorkflows(results, sort)
  const start = (page - 1) * limit

  return {
    data: sorted.slice(start, start + limit),
    total: results.length,
    page,
    totalPages: Math.ceil(results.length / limit),
  }
}

export function getPinnedWorkflows(creatorId) {
  const creator = creators.find((c) => c.id === creatorId)
  if (!creator) return []

  return creator.pinnedWorkflowIds
    .map((id) => workflows.find((w) => w.id === id))
    .filter(Boolean)
}

export function getCreatorCollections(creatorId) {
  const creator = creators.find((c) => c.id === creatorId)
  if (!creator) return []

  return creator.collections.map((col) => ({
    ...col,
    workflows: col.workflowIds
      .map((id) => workflows.find((w) => w.id === id))
      .filter(Boolean),
  }))
}

export function getFollowers(creatorId, limit = 20) {
  // Mock: return other creators as "followers"
  return creators
    .filter((c) => c.id !== creatorId)
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      handle: c.handle,
      displayName: c.displayName,
      avatarUrl: c.avatarUrl,
      workflowCount: c.stats.workflowCount,
    }))
}

function sortCreatorWorkflows(arr, sort) {
  switch (sort) {
    case 'popular':
      return [...arr].sort((a, b) => b.stats.runs - a.stats.runs)
    case 'newest':
      return [...arr].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    case 'runs':
      return [...arr].sort((a, b) => b.stats.runs - a.stats.runs)
    case 'favorites':
      return [...arr].sort((a, b) => b.stats.favorites - a.stats.favorites)
    default:
      return arr
  }
}
