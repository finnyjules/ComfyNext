export const ITEMS_PER_PAGE = 24
export const AUTOCOMPLETE_LIMIT = 8
export const MAX_TAGS = 10
export const MAX_PINNED = 5

export const DIFFICULTY_LEVELS = ['Beginner', 'Intermediate', 'Advanced']

export const OUTPUT_TYPES = ['Single Image', 'Image Batch', 'Video', 'Audio', '3D']

export const INPUT_TYPES = ['Text Prompt', 'Image', 'Image + Prompt', 'Video', 'Batch', 'Multi-input']

export const BASE_MODELS = [
  'FLUX.1 Dev',
  'FLUX.1 Schnell',
  'SDXL',
  'SD 1.5',
  'Stable Cascade',
  'Hunyuan',
  'Pixart',
  'Playground v2.5',
]

export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'newest', label: 'Most Recent' },
  { value: 'runs', label: 'Most Runs' },
  { value: 'alphabetical', label: 'Alphabetical' },
]
