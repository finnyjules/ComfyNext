/**
 * Brand → Comfy iconify slug mapping.
 *
 * Comfy ships partner-vendor logos in its iconify "comfy" collection (see
 * assets/css/comfy-partner-icons.css). Each slug = name lowercased with
 * spaces → dashes. Two flavors:
 *
 *  - **Monochrome**: mask-image based, needs an explicit fg color (we use
 *    `bg-white` so the glyph is visible on the colored brand swatch).
 *  - **Color**: background-image, baked-in gradients (don't tint).
 *
 * Brands without a Comfy icon (Alibaba, Pruna, Meta) fall back to the brand
 * initial — that's what `iconForBrand` returns null for. Use `getBrandIcon`
 * which yields a small descriptor the caller can spread onto an element.
 */
import type { ImageModelBrand } from './image-models'

export type BrandIconStyle = 'mono' | 'color'

interface BrandIcon {
  /** Iconify class, e.g. 'icon-[comfy--bfl]'. */
  cssClass: string
  /** Mono icons need an explicit foreground color (we pair with bg-white). */
  style: BrandIconStyle
}

// Mapping from our brand names to the comfy iconify slug. `null` means we
// have no icon for that brand and the caller should fall back to a wordmark
// or initial. Typed loosely (`Record<string, …>`) so video-only brands can
// share the same map without forcing them into the ImageModelBrand union.
const BRAND_TO_COMFY_SLUG: Record<string, { slug: string; style: BrandIconStyle } | null> = {
  // ---- Image-catalog brands -----------------------------------------------
  'BFL':          { slug: 'bfl',          style: 'mono'  },
  // Google's image models are all Gemini/Imagen branding — the comfy collection
  // ships the Gemini logo, which doubles as a Google glyph.
  'Google':       { slug: 'gemini',       style: 'color' },
  'OpenAI':       { slug: 'openai',       style: 'mono'  },
  'ByteDance':    { slug: 'bytedance',    style: 'color' },
  'Ideogram':     { slug: 'ideogram',     style: 'mono'  },
  'Recraft':      { slug: 'recraft',      style: 'mono'  },
  'Stability AI': { slug: 'stability-ai', style: 'color' },
  // Alibaba's image models (Wan/Qwen) share Wan branding in Comfy.
  'Alibaba':      { slug: 'wan',          style: 'color' },
  'Tencent':      { slug: 'tencent',      style: 'color' },
  'xAI':          { slug: 'grok',         style: 'mono'  },
  'Pruna':        null,
  'Meta':         null,
  'Bria':         { slug: 'bria',         style: 'mono'  },
  'Luma':         { slug: 'luma',         style: 'color' },
  'MiniMax':      { slug: 'minimax',      style: 'color' },
  'Reve':         null,
  // ---- Video-only brands --------------------------------------------------
  // Wan is its own brand in the video catalog (open-source video lineage),
  // distinct from Alibaba above which uses the same iconify slug.
  'Wan':          { slug: 'wan',          style: 'color' },
  // Kling = kwaivgi on Replicate. Comfy ships the Kling glyph.
  'Kling':        { slug: 'kling',        style: 'color' },
  // Runway and Lightricks ship in Comfy's collection.
  'Runway':       { slug: 'runwayml',     style: 'mono'  },
  'Lightricks':   { slug: 'lightricks',   style: 'color' },
  'PixVerse':     { slug: 'pixverse',     style: 'color' },
  // VEED's brand isn't in Comfy's iconify collection — fall back to wordmark.
  'VEED':         null,
  'Other':        null,
}

export function getBrandIcon(brand: string): BrandIcon | null {
  const entry = BRAND_TO_COMFY_SLUG[brand]
  if (!entry) return null
  return {
    cssClass: `icon-[comfy--${entry.slug}]`,
    style: entry.style,
  }
}

/**
 * Single source of truth for brand accent colors. Pulled out of the modal /
 * launcher components so they stay in sync. Used as: launcher button swatch
 * background, detail-pane chip background, card hover gradient, etc.
 */
export const BRAND_COLORS: Record<string, string> = {
  // Image-catalog brands
  'BFL':          '#ff6b8b',
  'Google':       '#4796ff',
  'OpenAI':       '#10a37f',
  'ByteDance':    '#26a6ff',
  'Ideogram':     '#a86bff',
  'Recraft':      '#ffb84d',
  'Stability AI': '#ff8a4d',
  'Alibaba':      '#ff7a3d',
  'Tencent':      '#48a8ff',
  'xAI':          '#cccccc',
  'Pruna':        '#9b6bff',
  'Meta':         '#3d7aff',
  'Bria':         '#56c69e',
  'Luma':         '#ffcb47',
  'MiniMax':      '#ff5e7e',
  'Reve':         '#c7b1ff',
  'Krea':         '#7c5cff',
  // Video-only brands
  'Wan':          '#ff7a3d',
  'Kling':        '#3da5ff',
  'Runway':       '#dddddd',
  'Lightricks':   '#ff9933',
  'PixVerse':     '#7c3aed',
  'VEED':         '#34d399',
  'Other':        '#888888',
}
