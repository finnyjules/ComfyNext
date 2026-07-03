/** Picker-side quality cues for web-image-search results. Pure — unit-tested. */
import type { ImageSearchResult } from '~~/server/utils/imageSearch'

/** Long edge below this is a thumbnail-grade image — fine as a reference,
 *  disappointing as an import into a generation pipeline. */
const SMALL_LONG_EDGE = 800

/** True when we KNOW the image is small. Unknown size is not punished — plenty
 *  of hosts hide dimensions from the probe but serve full-size files. */
export function isSmallImage(r: ImageSearchResult): boolean {
  if (!r.width || !r.height) return false
  return Math.max(r.width, r.height) < SMALL_LONG_EDGE
}

/** Keep the search's relevance order, but sink known-small images to the end
 *  so the top of the grid is always worth importing. Stable within each bucket. */
export function orderBySize(results: ImageSearchResult[]): ImageSearchResult[] {
  return [...results.filter(r => !isSmallImage(r)), ...results.filter(isSmallImage)]
}
