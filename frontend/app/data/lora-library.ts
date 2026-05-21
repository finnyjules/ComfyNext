/**
 * Curated set of public Flux LoRAs hosted on HuggingFace. Replicate's
 * black-forest-labs/flux-dev-lora accepts the `hf_lora` parameter as either
 * an `owner/repo` HuggingFace path or a direct .safetensors URL — these all
 * use the path form.
 *
 * Each entry includes the trigger word(s) needed to "activate" the LoRA in a
 * prompt. The LoRA Library panel surfaces these so users don't have to copy
 * HF paths by hand.
 *
 * Adding a new entry: copy the model's HuggingFace card URL, grab the path
 * after huggingface.co/, paste it as `hfPath`. Pull the trigger word from
 * the README. Pick a category from the union below.
 */

export type LoRACategory =
  | 'Realism'
  | 'Illustration'
  | 'Stylized'
  | 'Anime'
  | 'Niche'

export interface LoRALibraryEntry {
  /** owner/repo on HuggingFace — what Replicate's `hf_lora` field needs. */
  hfPath: string
  /** Display name on the tile. */
  label: string
  /** Word(s) that "activate" the LoRA when present in a prompt. */
  trigger: string
  /** Single sentence on the tile. */
  blurb: string
  category: LoRACategory
  /** HuggingFace username — for attribution / discovery. */
  author: string
  /** Example prompt template that exercises the trigger. */
  examplePrompt?: string
  /** Suggested lora_scale override (0–2). Most LoRAs work at 1.0. */
  suggestedScale?: number
}

export const LORA_LIBRARY: LoRALibraryEntry[] = [
  // ── Realism ───────────────────────────────────────────────────────────
  {
    hfPath: 'XLabs-AI/flux-RealismLora',
    label: 'Flux Realism',
    trigger: 'photo',
    blurb: 'Boosts realism, skin detail and lighting. The OG Flux realism LoRA.',
    category: 'Realism',
    author: 'XLabs-AI',
    examplePrompt: 'photo of a woman walking through tokyo at night, neon reflections on wet pavement',
  },
  {
    hfPath: 'alvdansen/flux-koda',
    label: 'Koda · Kodachrome',
    trigger: 'flmft style',
    blurb: 'Slightly nostalgic Kodachrome film aesthetic. Great for portraits and landscapes.',
    category: 'Realism',
    author: 'alvdansen',
    examplePrompt: 'flmft style photo of a small fishing village at golden hour, vintage feel',
  },
  {
    hfPath: 'multimodalart/flux-tarot-v1',
    label: 'Tarot Card',
    trigger: 'in the style of TOK a trtcrd tarot style card',
    blurb: 'Old tarot-card painted look — works surprisingly well for character portraits.',
    category: 'Realism',
    author: 'multimodalart',
    examplePrompt: 'in the style of TOK a trtcrd tarot style card depicting a wandering knight',
  },
  {
    hfPath: 'strangerzonehf/Flux-Polaroid-Plus',
    label: 'Polaroid Plus',
    trigger: 'Polaroid Photo',
    blurb: 'Genuine instant-film aesthetic — soft focus, warm tones, characteristic border.',
    category: 'Realism',
    author: 'strangerzonehf',
    examplePrompt: 'Polaroid Photo of a couple dancing in their kitchen at midnight',
  },
  {
    hfPath: 'strangerzonehf/Flux-Super-Realism-LoRA',
    label: 'Super Realism',
    trigger: 'Super Realism',
    blurb: 'Hyperdetail boost — pores, fabric weave, micro-shadows. Use sparingly.',
    category: 'Realism',
    author: 'strangerzonehf',
    examplePrompt: 'Super Realism portrait of an elderly carpenter in his workshop, dust in the light',
    suggestedScale: 0.8,
  },
  {
    hfPath: 'prithivMLmods/Canopus-LoRA-Flux-FaceRealism',
    label: 'Face Realism',
    trigger: 'face realism',
    blurb: 'Face-focused detail boost — skin texture, eye reflections, micro-expressions.',
    category: 'Realism',
    author: 'prithivMLmods',
    examplePrompt: 'face realism, portrait of a woman in her late twenties with light brown hair, soft window light',
  },
  {
    hfPath: 'alvdansen/pola-photo-flux',
    label: 'Polaroid Mood',
    trigger: 'polaroid style',
    blurb: 'Polaroid film with painterly warmth. Softer than Polaroid Plus.',
    category: 'Realism',
    author: 'alvdansen',
    examplePrompt: 'a girl laughing at a beach party, polaroid style',
  },
  {
    hfPath: 'dvyio/flux-lora-film-noir',
    label: 'Film Noir',
    trigger: 'in the style of FLMNR',
    blurb: 'Hard-shadow black-and-white cinematography. 1940s detective vibes.',
    category: 'Realism',
    author: 'dvyio',
    examplePrompt: 'a parrot sitting in its cage, dramatic shadows cast against the wall, in the style of FLMNR',
  },

  // ── Illustration ──────────────────────────────────────────────────────
  {
    hfPath: 'alvdansen/frosting_lane_flux',
    label: 'Frosting Lane',
    trigger: 'frstingln illustration',
    blurb: 'Soft polished storybook illustrations. Painterly without being heavy-handed.',
    category: 'Illustration',
    author: 'alvdansen',
    examplePrompt: 'frstingln illustration of a tiny cottage in a misty forest at dawn',
  },
  {
    hfPath: 'alvdansen/softpasty-flux-dev',
    label: 'Soft Pasty',
    trigger: 'araminta_illus illustration style',
    blurb: 'Pastel, hand-drawn, very gentle. Editorial illustration energy.',
    category: 'Illustration',
    author: 'alvdansen',
    examplePrompt: 'araminta_illus illustration style of two friends sharing tea in a sunlit kitchen',
  },
  {
    hfPath: 'alvdansen/littletinies',
    label: 'Little Tinies',
    trigger: 'lttntny style',
    blurb: 'Tiny chibi-style characters with big personalities.',
    category: 'Illustration',
    author: 'alvdansen',
    examplePrompt: 'lttntny style of a small wizard reading a giant book',
  },
  {
    hfPath: 'strangerzonehf/Flux-Sketch-Sized-LoRA',
    label: 'Sketch Sized',
    trigger: 'Sketch Sized',
    blurb: 'Pencil sketch with painterly fill — fast, hand-drawn feel.',
    category: 'Illustration',
    author: 'strangerzonehf',
    examplePrompt: 'Sketch Sized portrait of a violinist mid-performance',
  },
  {
    hfPath: 'aleksa-codes/flux-ghibsky-illustration',
    label: 'Ghibsky',
    trigger: 'GHIBSKY style',
    blurb: 'Studio Ghibli meets Makoto Shinkai sky — dreamy clouds, warm light.',
    category: 'Illustration',
    author: 'aleksa-codes',
    examplePrompt: 'GHIBSKY style illustration of a girl on a bicycle riding through endless rice fields',
  },
  {
    hfPath: 'alvdansen/sketchedoutmanga',
    label: 'Sketched Manga',
    trigger: 'daiton',
    blurb: 'Loose sketched-out manga linework — energetic, unfinished, full of motion.',
    category: 'Illustration',
    author: 'alvdansen',
    examplePrompt: 'daiton style of a young hero leaping over rooftops, dramatic angle',
  },
  {
    hfPath: 'prithivMLmods/Coloring-Book-Flux-LoRA',
    label: 'Coloring Book',
    trigger: 'Coloring Book',
    blurb: 'Clean black-line coloring-book pages. White fill, no shading.',
    category: 'Illustration',
    author: 'prithivMLmods',
    examplePrompt: 'Coloring Book illustration of a friendly dragon reading to a child',
  },
  {
    hfPath: 'alvdansen/haunted_linework_flux',
    label: 'Haunted Linework',
    trigger: 'hntdlnwrk style',
    blurb: 'Gothic-leaning ink illustration — heavy linework, eerie atmosphere.',
    category: 'Illustration',
    author: 'alvdansen',
    examplePrompt: 'closeup of a retro television set broadcasting dreams and memories, hntdlnwrk style',
  },
  {
    hfPath: 'multimodalart/ms-paint-drawing-flux',
    label: 'MS Paint',
    trigger: 'MSPaint portrait',
    blurb: 'Low-fidelity Microsoft Paint drawings. Charming, deliberately bad.',
    category: 'Illustration',
    author: 'multimodalart',
    examplePrompt: 'MSPaint portrait, MSPaint drawing of a chef holding a pizza, casual photograph repurposed',
  },
  {
    hfPath: 'dvyio/flux-lora-stippled-illustration',
    label: 'Stippled',
    trigger: 'stippled illustration in the style of STPPLD',
    blurb: 'Dotted pen-and-ink stippling — every shadow is thousands of tiny dots.',
    category: 'Illustration',
    author: 'dvyio',
    examplePrompt: 'close-up of an old wizard\'s face, stippled illustration in the style of STPPLD',
  },

  // ── Anime ─────────────────────────────────────────────────────────────
  {
    hfPath: 'alvdansen/sonny-anime-fixed',
    label: 'Sonny Anime',
    trigger: 'nm22 style',
    blurb: 'Clean cel-shaded anime. Less moé, more shōnen poster.',
    category: 'Anime',
    author: 'alvdansen',
    examplePrompt: 'nm22 style of a swordsman atop a windswept cliff at sunset',
  },
  {
    hfPath: 'dataautogpt3/FLUX-AestheticAnime',
    label: 'Aesthetic Anime',
    trigger: 'anime',
    blurb: 'Modern aesthetic-anime look — muted palette, soft lighting, magazine vibes.',
    category: 'Anime',
    author: 'dataautogpt3',
    examplePrompt: 'anime portrait of a girl with headphones in a sunlit bedroom, lo-fi mood',
  },
  {
    hfPath: 'glif/90s-anime-art',
    label: '90s Anime Art',
    trigger: '90s anime art',
    blurb: 'VHS-era anime: thick lines, dense screen-tone, Akira-meets-Sailor-Moon energy.',
    category: 'Anime',
    author: 'glif',
    examplePrompt: '90s anime art of a girl on a motorbike at neon-soaked night, retro vibes',
  },
  {
    hfPath: 'glif/anime-blockprint-style',
    label: 'Anime Blockprint',
    trigger: 'blockprint',
    blurb: 'Woodblock-print interpretation of anime subjects. Bold, graphic, traditional.',
    category: 'Anime',
    author: 'glif',
    examplePrompt: 'blockprint of a samurai under a full moon, ukiyo-e composition',
  },
  {
    hfPath: 'prithivMLmods/Canopus-LoRA-Flux-Anime',
    label: 'Canopus Anime',
    trigger: 'Anime',
    blurb: 'Polished masterpiece-tier anime. Crisp linework, vivid color.',
    category: 'Anime',
    author: 'prithivMLmods',
    examplePrompt: 'Anime masterpiece, best quality, a girl with windswept hair on a clifftop, outdoor',
  },
  {
    hfPath: 'strangerzonehf/Flux-Animex-v2-LoRA',
    label: 'Animex',
    trigger: 'Animex',
    blurb: 'Animated-movie still aesthetic. Bold cartoon proportions, vibrant palette.',
    category: 'Anime',
    author: 'strangerzonehf',
    examplePrompt: 'Animex, a vibrant cartoon drawing of a man\'s face, expressive eyes',
  },

  // ── Stylized ──────────────────────────────────────────────────────────
  {
    hfPath: 'lichorosario/lora-flux-3d-isometric',
    label: '3D Isometric',
    trigger: 'isometric',
    blurb: 'Clean 3D isometric scenes — rooms, dioramas, miniature worlds.',
    category: 'Stylized',
    author: 'lichorosario',
    examplePrompt: 'isometric tiny coffee shop interior with warm lighting',
  },
  {
    hfPath: 'fofr/flux-handwriting',
    label: 'Handwriting',
    trigger: 'HWRIT handwriting',
    blurb: 'Generates handwritten text that actually looks handwritten.',
    category: 'Stylized',
    author: 'fofr',
    examplePrompt: 'HWRIT handwriting on lined paper saying "thank you for coming"',
  },
  {
    hfPath: 'multimodalart/product-design',
    label: 'Product Design',
    trigger: 'in the style of pdsgn',
    blurb: 'Clean mockup-style product shots. Studio lighting, neutral backdrops.',
    category: 'Stylized',
    author: 'multimodalart',
    examplePrompt: 'product design, in the style of pdsgn, minimalist ceramic teapot',
  },
  {
    hfPath: 'Shakker-Labs/FLUX.1-dev-LoRA-MiaoKa-Yarn-World',
    label: 'Yarn World',
    trigger: 'Yarn art style',
    blurb: 'Everything rendered as knitted yarn — adorable handcraft aesthetic.',
    category: 'Stylized',
    author: 'Shakker-Labs',
    examplePrompt: 'Yarn art style of a cozy mountain cabin in a snowy forest',
  },
  {
    hfPath: 'martintomov/retrofuturism-flux',
    label: 'Retrofuturism',
    trigger: 'retrofuturism',
    blurb: '70s/80s vision of the future — chrome, geometric patterns, optimistic decay.',
    category: 'Stylized',
    author: 'martintomov',
    examplePrompt: 'retrofuturism poster of a moon colony market, vibrant analog feel',
  },
  {
    hfPath: 'strangerzonehf/Flux-Claymation-XC-LoRA',
    label: 'Claymation',
    trigger: 'Claymation',
    blurb: 'Stop-motion clay character look — soft, tactile, slightly imperfect.',
    category: 'Stylized',
    author: 'strangerzonehf',
    examplePrompt: 'Claymation of a tiny astronaut planting a flag on a cookie planet',
  },
  {
    hfPath: 'prithivMLmods/Canopus-Pixar-3D-Flux-LoRA',
    label: 'Pixar 3D',
    trigger: 'Pixar 3D',
    blurb: 'Pixar-style 3D character animation look. Soft lighting, expressive faces.',
    category: 'Stylized',
    author: 'prithivMLmods',
    examplePrompt: 'Pixar 3D, cute girl with a balloon walking through a windswept meadow',
  },
  {
    hfPath: 'strangerzonehf/Flux-Cute-3D-Kawaii-LoRA',
    label: 'Cute 3D Kawaii',
    trigger: 'Cute 3d Kawaii',
    blurb: 'Chibi 3D kawaii — round, pastel, painfully cute.',
    category: 'Stylized',
    author: 'strangerzonehf',
    examplePrompt: 'Cute 3d Kawaii, a tiny cartoon figure standing on a light blue surface, soft pastel palette',
  },
  {
    hfPath: 'alvdansen/plushy-world-flux',
    label: 'Plushy World',
    trigger: '3dcndylnd style',
    blurb: 'Everything as plush toys. Soft fabric, button eyes, candyland palette.',
    category: 'Stylized',
    author: 'alvdansen',
    examplePrompt: 'a cute toad sitting on a mushroom, 3dcndylnd style',
  },
  {
    hfPath: 'fofr/flux-80s-cyberpunk',
    label: '80s Cyberpunk',
    trigger: '80s cyberpunk',
    blurb: 'Neon-drenched 80s sci-fi aesthetic — Blade Runner, Akira, Tron.',
    category: 'Stylized',
    author: 'fofr',
    examplePrompt: 'style of 80s cyberpunk, a portrait photo of a hacker in a neon-lit alley',
  },

  // ── Niche ─────────────────────────────────────────────────────────────
  {
    hfPath: 'XLabs-AI/flux-furry-lora',
    label: 'Furry',
    trigger: 'furry',
    blurb: 'Anthropomorphic characters in a polished painted style.',
    category: 'Niche',
    author: 'XLabs-AI',
    examplePrompt: 'furry fox character in a vintage detective coat',
  },
  {
    hfPath: 'dvyio/flux-lora-blueprint',
    label: 'Blueprint',
    trigger: 'BLUPRNT blueprint',
    blurb: 'Technical blueprint illustration — white lines on cyan, dimension lines.',
    category: 'Niche',
    author: 'dvyio',
    examplePrompt: 'BLUPRNT blueprint of an electric guitar with annotations',
  },
  {
    hfPath: 'prithivMLmods/Pixel-Background-Flux-LoRA',
    label: 'Pixel Background',
    trigger: 'Pixel Background',
    blurb: 'Wide-format 16-bit-era pixel-art backgrounds. Game-ready landscapes.',
    category: 'Niche',
    author: 'prithivMLmods',
    examplePrompt: 'Pixel Background of an ancient temple at sunset, parallax mountains behind',
  },
  {
    hfPath: 'prithivMLmods/Castor-3D-Sketchfab-Flux-LoRA',
    label: '3D Sketchfab',
    trigger: '3D Sketchfab',
    blurb: 'Asset-store 3D-render look — soft-clay shading, neutral background.',
    category: 'Niche',
    author: 'prithivMLmods',
    examplePrompt: '3D Sketchfab model of a chunky low-poly fox on a hex tile',
  },
  {
    hfPath: 'fofr/flux-bad-70s-food',
    label: 'Bad 70s Food',
    trigger: 'bad 70s food',
    blurb: 'Gloomy aspic-and-jello cookbook photography from the 70s. Cursed and beautiful.',
    category: 'Niche',
    author: 'fofr',
    examplePrompt: 'a photo of bad 70s food, mystery loaf surrounded by canned peaches',
  },
  {
    hfPath: 'dvyio/flux-lora-victorian-satire',
    label: 'Victorian Satire',
    trigger: 'in the style of a Victorian-era TOK cartoon illustration',
    blurb: 'Punch-magazine satirical cartoon style. Crosshatching, exaggerated faces.',
    category: 'Niche',
    author: 'dvyio',
    examplePrompt: 'a man talking on a telephone, in the style of a Victorian-era TOK cartoon illustration',
  },
]

export const LORA_CATEGORIES: LoRACategory[] = [
  'Realism',
  'Illustration',
  'Stylized',
  'Anime',
  'Niche',
]
