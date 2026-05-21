/** Partner node icon mapping: folder/company name → SVG icon path */
export const PARTNER_ICONS: Record<string, string> = {
  'BFL': '/icons/partners/BFL.svg',
  'Bria': '/icons/partners/Bria.svg',
  'ByteDance': '/icons/partners/ByteDance.svg',
  'Gemini': '/icons/partners/Gemini.svg',
  'Grok': '/icons/partners/Grok.svg',
  'HitPaw': '/icons/partners/HitPaw.svg',
  'Ideogram': '/icons/partners/Ideogram.svg',
  'Kling': '/icons/partners/Kling.svg',
  'LTXV': '/icons/partners/LTXV.svg',
  'Luma': '/icons/partners/Luma.svg',
  'Magnific': '/icons/partners/Magnific.svg',
  'Meshy': '/icons/partners/Meshy.svg',
  'MiniMax': '/icons/partners/Minimax.svg',
  'Moonvalley Marey': '/icons/partners/Moonvalley.svg',
  'OpenAI': '/icons/partners/OpenAI.svg',
  'PixVerse': '/icons/partners/Pixverse.svg',
  'Recraft': '/icons/partners/Recraft.svg',
  'Reve': '',
  'Rodin': '/icons/partners/Rodin.svg',
  'Runway': '/icons/partners/Runway.svg',
  'Sora': '/icons/partners/Sora.svg',
  'Stability AI': '/icons/partners/Stability.svg',
  'ElevenLabs': '',
  'Tencent': '/icons/partners/Tencent.svg',
  'Topaz': '/icons/partners/Topaz Labs.svg',
  'Tripo': '/icons/partners/Tripo.svg',
  'Veo': '/icons/partners/Veo.svg',
  'Vidu': '/icons/partners/Vidu.svg',
  'Wan': '/icons/partners/Wan.svg',
  'WaveSpeed': '/icons/partners/WaveSpeed.svg',
}

/** Get partner icon URL from a node category string (e.g. "api/Gemini/...") */
export function getPartnerIcon(category: string): string | null {
  if (!category) return null
  const parts = category.split('/')
  for (const part of parts) {
    const icon = PARTNER_ICONS[part]
    if (icon) return icon
  }
  return null
}
