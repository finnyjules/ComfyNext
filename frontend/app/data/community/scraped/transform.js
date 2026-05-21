/**
 * Transforms scraped template data into workflow objects
 * matching the exact schema expected by workflowService.js and all UI components.
 *
 * Real data from scraping: title, slug, description, thumbnails, categories, models
 * Synthetic data via seeded faker: stats, nodes, edges, parameters, versions, etc.
 */

import { faker } from '@faker-js/faker'

import {
  mapToCategory,
  getCategoryLabel,
  mapToBaseModel,
  extractTags,
  extractTechniques,
} from './category-map.js'

import {
  generateNodes,
  generateEdges,
  generateParameters,
  generateDependencies,
  generateVersions,
  generateOutputImages,
} from '../mock/generators/workflows.js'

// Vite handles JSON imports natively — no fs/path needed
import rawData from './templates.json'

const templates = rawData.templates

// ─── Pinned featured workflows (shown first in carousel) ────────────

const pinnedFeaturedSlugs = new Set([
  'templates-qwen_multiangle',
  'api_kling_omni_edit_video',
  'templates-multiple_consistent_shots-nb_pro',
  'templates-fashion_shoot_vton',
  'templates-character_sheet',
])

// ─── Helpers ─────────────────────────────────────────────────────────

const inputTypes = [
  'Text Prompt', 'Image + Text', 'Image Only', 'Batch Images',
  'Video', 'Depth Map + Text', 'Pose + Text', 'Sketch + Text',
]

const outputTypes = [
  'Single Image', 'Multiple Images', 'Image Grid', 'Upscaled Image',
  'Video', 'Image Sequence', 'Inpainted Image', 'Style-Transferred Image',
]

const licenses = ['MIT', 'Apache-2.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'GPL-3.0']

/**
 * Parse "X months ago" / "X weeks ago" relative date strings into a Date.
 * Anchored to the scrape date for consistency.
 */
function parseRelativeDate(relStr, anchor) {
  if (!relStr) return anchor

  const match = relStr.match(/(\d+)\s*(month|week|day|year|hour|minute)s?\s*ago/i)
  if (!match) return anchor

  const amount = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  const d = new Date(anchor)

  switch (unit) {
    case 'year': d.setFullYear(d.getFullYear() - amount); break
    case 'month': d.setMonth(d.getMonth() - amount); break
    case 'week': d.setDate(d.getDate() - amount * 7); break
    case 'day': d.setDate(d.getDate() - amount); break
    case 'hour': d.setHours(d.getHours() - amount); break
    case 'minute': d.setMinutes(d.getMinutes() - amount); break
  }
  return d
}

/**
 * Parse "9-26 seconds" or "1-3 minutes" → average in seconds
 */
function parseEstTime(estStr) {
  if (!estStr) return faker.number.int({ min: 10, max: 60 })

  const match = estStr.match(/([\d.]+)-([\d.]+)\s*(second|minute|hour)s?/i)
  if (!match) return faker.number.int({ min: 10, max: 60 })

  const lo = parseFloat(match[1])
  const hi = parseFloat(match[2])
  const unit = match[3].toLowerCase()
  const avg = (lo + hi) / 2

  switch (unit) {
    case 'minute': return Math.round(avg * 60)
    case 'hour': return Math.round(avg * 3600)
    default: return Math.round(avg)
  }
}

/**
 * Infer difficulty from download size and est time
 */
function inferDifficulty(downloadSize, estTime) {
  const sizeGB = parseFloat(downloadSize) || 0
  const timeSec = parseEstTime(estTime)

  if (sizeGB > 30 || timeSec > 180) return 'Advanced'
  if (sizeGB > 10 || timeSec > 60) return 'Intermediate'
  return 'Beginner'
}

/**
 * Generate a markdown description using real source data
 */
function generateDescription(template, categoryLabel, baseModel, techniqueList, nodeCount) {
  const { title, description: srcDesc, categories: srcCats = [], models: srcModels = [] } = template

  const featureItems = []
  if (srcCats.length > 0) featureItems.push(`Supports ${srcCats.slice(0, 3).join(', ')} workflows`)
  if (srcModels.length > 0) featureItems.push(`Powered by ${srcModels.join(', ')}`)
  if (template.downloadSize) featureItems.push(`Download size: ${template.downloadSize}`)
  if (template.estTime) featureItems.push(`Estimated generation time: ${template.estTime}`)
  featureItems.push('Fully customizable parameters for fine-tuning')
  featureItems.push('Optimized for speed without sacrificing quality')

  return `# ${title}

## Overview
${srcDesc || `A professional ${categoryLabel.toLowerCase()} workflow built on **${baseModel}**.`} This workflow uses ${nodeCount} nodes and integrates ${techniqueList.join(', ')} for optimal results.

## Features
${featureItems.map((f) => `- ${f}`).join('\n')}

## Usage
1. Load the workflow into ComfyUI
2. Adjust the parameters in the sidebar to match your needs
3. Enter your prompt in the text encode node
4. Click "Queue Prompt" to generate

## Requirements
- ComfyUI latest version
- ${baseModel} checkpoint
- Minimum 8GB VRAM recommended
`
}

// ─── Transform ───────────────────────────────────────────────────────

function transformTemplates() {
  // Seed faker for reproducible synthetic data
  faker.seed(42)

  const anchorDate = new Date(rawData.scrapedAt)
  const now = new Date('2026-02-15T00:00:00Z')
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const workflows = []

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]
    const id = `wf_${String(i + 1).padStart(4, '0')}`

    // ── Real data ──────────────────────────────────────────────

    const slug = t.slug
    const title = t.title
    const shortDescription = t.description || `A ComfyUI workflow for ${t.type || 'image generation'}.`

    // Thumbnails
    const thumbnailUrl = t.thumbnails?.[0] || `https://picsum.photos/seed/${id}/400/300`
    const realImages = t.thumbnails?.length > 0
      ? t.thumbnails.map((url, idx) => ({
        url,
        caption: idx === 0 ? 'Example output with default settings' : `Output variation ${idx + 1}`,
      }))
      : []

    // [DUMMY] Pad each workflow to 4-5 output images with placeholders
    const dummyCount = Math.max(0, faker.number.int({ min: 4, max: 5 }) - realImages.length)
    const dummyImages = Array.from({ length: dummyCount }, (_, j) => ({
      url: `https://picsum.photos/seed/${id}_dummy${j}/800/600`,
      caption: `Example variation ${realImages.length + j + 1}`,
      _dummy: true, // [DUMMY] tag — remove these when real assets are available
    }))
    const outputImages = [...realImages, ...dummyImages]

    // Category mapping
    const categoryId = mapToCategory(t.type, t.category, t.categories)
    const categoryLabel = getCategoryLabel(categoryId)

    // Model mapping
    const baseModel = mapToBaseModel(t.models)

    // Tags from detail categories
    const tags = extractTags(t.categories, t.type)

    // Techniques
    const techniqueList = extractTechniques(t.categories)

    // Dates
    const lastUpdateDate = parseRelativeDate(t.lastUpdate, anchorDate)
    const updatedAt = lastUpdateDate.toISOString()
    // Created is roughly 1-6 months before last update
    const createdOffset = faker.number.int({ min: 30, max: 180 }) * 24 * 60 * 60 * 1000
    const createdAt = new Date(lastUpdateDate.getTime() - createdOffset)

    // ── Synthetic data (seeded per workflow) ────────────────────

    // Difficulty
    const difficulty = inferDifficulty(t.downloadSize, t.estTime)

    // Estimated time (in seconds)
    const estimatedTime = parseEstTime(t.estTime)

    // Flags
    const isNew = createdAt >= sevenDaysAgo || faker.datatype.boolean(0.05)
    const isUpdated = !isNew && faker.datatype.boolean(0.15)
    const isPinned = pinnedFeaturedSlugs.has(t.slug)
    const isFeatured = isPinned || t.isPopular || faker.datatype.boolean(0.03)
    const isStaffPick = t.isPopular && faker.datatype.boolean(0.15)

    // Stats — popular items get boosted
    const popularityMultiplier = t.isPopular ? faker.number.float({ min: 3, max: 5 }) : 1
    const ageInDays = Math.max(1, Math.floor((now - createdAt) / (24 * 60 * 60 * 1000)))
    const baseFactor = faker.number.float({ min: 0.3, max: 2.5 })

    const runs = Math.floor(ageInDays * baseFactor * popularityMultiplier * faker.number.int({ min: 15, max: 70 }))
    const favorites = Math.floor(runs * faker.number.float({ min: 0.04, max: 0.12 }))
    const forks = Math.floor(favorites * faker.number.float({ min: 0.05, max: 0.25 }))
    const commentCount = Math.floor(favorites * faker.number.float({ min: 0.03, max: 0.15 }))

    // Nodes and edges
    const nodes = generateNodes(categoryId)
    const edges = generateEdges(nodes)

    // Parameters
    const parameters = generateParameters()

    // Dependencies
    const dependencies = generateDependencies(baseModel, techniqueList)

    // Versions
    const versions = generateVersions(createdAt.toISOString())

    // Input/output types
    const inputType = faker.helpers.arrayElement(inputTypes)
    const outputType = faker.helpers.arrayElement(outputTypes)

    // Subcategory — pick from the matching category definition
    const subcategory = faker.helpers.arrayElement([
      t.type || categoryLabel,
      ...(t.categories?.slice(0, 2) || []),
    ])

    // Description (markdown)
    const description = generateDescription(t, categoryLabel, baseModel, techniqueList, nodes.length)

    // Creator — all scraped workflows come from the ComfyUI official account
    const creator = {
      id: 'cr_comfyui',
      handle: '@comfyui',
      displayName: 'ComfyUI',
      avatarUrl: 'https://preview.redd.it/new-comfyui-logo-icon-v0-c05cowjywfze1.png?width=640&crop=smart&auto=webp&s=d381ee8ada0a2b993684c9ef26daf744c43350e2',
    }

    workflows.push({
      id,
      slug,
      title,
      shortDescription,
      description,
      creator,
      category: categoryId,
      categoryLabel,
      subcategory,
      baseModel,
      tags,
      techniques: techniqueList,
      difficulty,
      inputType,
      outputType,
      estimatedTime,
      thumbnailUrl,
      outputImages,
      hasBeforeAfter: realImages.length === 2, // real scraped images form a before/after pair
      stats: {
        runs,
        favorites,
        forks,
        comments: commentCount,
      },
      parameters,
      nodes,
      edges,
      dependencies,
      versions,
      license: faker.helpers.arrayElement(licenses),
      isNew,
      isUpdated,
      isFeatured,
      isStaffPick,
      createdAt: createdAt.toISOString(),
      updatedAt,
    })
  }

  return workflows
}

export const transformedWorkflows = transformTemplates()
