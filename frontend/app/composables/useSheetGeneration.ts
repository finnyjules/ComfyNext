/**
 * Higgsfield 5-panel generation pipeline: a large ¾ PORTRAIT is generated
 * first (photo mode → /api/cloud-train/character-shot, LoRA mode →
 * useInpaint().loraGen) — that portrait is the identity source. Every other
 * panel (two headless full-body, two face close-ups) is then DERIVED from the
 * portrait via a nano-banana edit call (/api/inpaint/nano-gen), not generated
 * independently, so identity can't drift panel to panel.
 *
 * Sequential + abort-on-first-failure (the money guard): a portrait failure
 * means zero derived calls happen; a failed derived panel stops the rest of
 * the queue rather than spending on panels likely to fail the same way.
 *
 * Descriptor-aware: an optional variant `descriptor` (e.g. "shaved head,
 * leather jacket") is threaded into the portrait prompt (alongside the LoRA
 * trigger) and appended as a wardrobe clause to every derived prompt, so a
 * sheet can be generated for a specific character variant. A separate
 * `bodyPhrase` (graded body-shape prose, see lib/characters/bodyPhrase.ts)
 * rides alongside it but is kept out of the wardrobe clause — a body isn't
 * something a person "wears" — and is appended as its own sentence instead.
 */
import { ref } from 'vue'
import { useInpaint } from '~/composables/useInpaint'
import { HIGGSFIELD_PANELS, type SheetPanelSpec } from '~/data/character-shot-scenes'
import type { PanelSlot } from '#shared/characters/types'

export interface PanelShot {
  spec: SheetPanelSpec
  dataUrl: string | null
  loading: boolean
  error: boolean
}

export type SheetSource =
  | { mode: 'photo'; referenceImageDataUrl: string; descriptor?: string; bodyPhrase?: string }
  | { mode: 'lora'; loraFilename: string; trigger: string | null; descriptor?: string; bodyPhrase?: string }

/**
 * Pure prompt builder for the portrait-gen panel: trigger (LoRA identity
 * token), variant descriptor, graded body phrase, then the panel prompt
 * itself, comma-joined — falsy pieces (missing trigger, no descriptor, no
 * body phrase) are dropped rather than leaving stray commas.
 */
export function buildPortraitPrompt(spec: SheetPanelSpec, opts: { trigger?: string | null; descriptor?: string; bodyPhrase?: string }): string {
  return [opts.trigger, opts.descriptor, opts.bodyPhrase, spec.prompt].filter(Boolean).join(', ')
}

/**
 * Pure prompt builder for a derived-edit panel: the panel prompt with an
 * optional wardrobe clause (descriptor) appended, followed by an optional
 * body clause (bodyPhrase) as its OWN sentence — a body isn't clothing, so it
 * must not get folded into the "The person wears …" clause (that produced
 * nonsense like "wears … a noticeably heavyset build").
 */
export function buildDerivedPrompt(spec: SheetPanelSpec, descriptor?: string, bodyPhrase?: string): string {
  let out = spec.prompt
  if (descriptor) out += ` The person wears ${descriptor}.`
  if (bodyPhrase) out += ` They have ${bodyPhrase}.`
  return out
}

function freshPanels(): PanelShot[] {
  return HIGGSFIELD_PANELS.map(spec => ({ spec, dataUrl: null, loading: false, error: false }))
}

export function useSheetGeneration() {
  const { loraGen } = useInpaint()
  const panels = ref<PanelShot[]>(freshPanels())

  function reset() {
    panels.value = freshPanels()
  }

  async function generatePortrait(spec: SheetPanelSpec, source: SheetSource): Promise<string> {
    if (source.mode === 'lora') {
      const prompt = buildPortraitPrompt(spec, { trigger: source.trigger, descriptor: source.descriptor, bodyPhrase: source.bodyPhrase })
      const images = await loraGen(source.loraFilename, prompt, spec.aspect)
      const url = images?.[0]
      if (!url) throw new Error('no image returned')
      return url
    }
    const res = await fetch('/api/cloud-train/character-shot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceImageDataUrl: source.referenceImageDataUrl,
        prompt: buildPortraitPrompt(spec, { descriptor: source.descriptor, bodyPhrase: source.bodyPhrase }),
        aspectRatio: spec.aspect,
      }),
    })
    if (!res.ok) throw new Error(`character-shot ${res.status}`)
    const { imageDataUrl } = await res.json() as { imageDataUrl?: string }
    if (!imageDataUrl) throw new Error('no image returned')
    return imageDataUrl
  }

  async function generateDerived(spec: SheetPanelSpec, portraitDataUrl: string, descriptor?: string, bodyPhrase?: string): Promise<string> {
    const res = await fetch('/api/inpaint/nano-gen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: buildDerivedPrompt(spec, descriptor, bodyPhrase),
        images: [portraitDataUrl],
        aspect_ratio: spec.aspect,
      }),
    })
    if (!res.ok) throw new Error(`nano-gen ${res.status}`)
    const { images } = await res.json() as { images?: string[] }
    const url = images?.[0]
    if (!url) throw new Error('no image returned')
    return url
  }

  /** Run one panel by index. `portraitDataUrl` is the identity source a
   *  derived-edit panel edits from — required for 'derived-edit' panels,
   *  unused for 'portrait-gen'. Returns whether it succeeded. */
  async function runPanel(idx: number, source: SheetSource, portraitDataUrl: string | null): Promise<boolean> {
    const panel = panels.value[idx]
    if (!panel) return false
    panel.loading = true
    panel.error = false
    try {
      const dataUrl = panel.spec.kind === 'portrait-gen'
        ? await generatePortrait(panel.spec, source)
        : await generateDerived(panel.spec, portraitDataUrl!, source.descriptor, source.bodyPhrase)
      panel.dataUrl = dataUrl
      return true
    } catch (e) {
      console.warn('[useSheetGeneration] panel failed', e)
      panel.error = true
      return false
    } finally {
      panel.loading = false
    }
  }

  async function expandAll(source: SheetSource) {
    // Sequential — portrait first, then derived panels edit off of it.
    // Abort-on-first-failure: a failed panel usually means the rest would
    // fail too (or, for the portrait, that there's nothing to derive from
    // yet) — don't spend on them.
    let portraitDataUrl: string | null = null
    for (let i = 0; i < panels.value.length; i++) {
      const ok = await runPanel(i, source, portraitDataUrl)
      if (!ok) break
      const panel = panels.value[i]
      if (panel?.spec.kind === 'portrait-gen') portraitDataUrl = panel.dataUrl
    }
  }

  /**
   * Re-render a single panel. A portrait reroll regenerates the identity
   * source itself; a derived-panel reroll re-edits from whatever portrait is
   * CURRENTLY on the sheet (not a freshly regenerated one) — it errors if no
   * portrait has been generated yet, since there's nothing to derive from.
   */
  async function rerollPanel(slot: PanelSlot, source: SheetSource) {
    const idx = panels.value.findIndex(p => p.spec.slot === slot)
    if (idx < 0) return
    const panel = panels.value[idx]!
    if (panel.spec.kind === 'derived-edit') {
      const portrait = panels.value.find(p => p.spec.kind === 'portrait-gen')
      if (!portrait?.dataUrl) throw new Error('Generate the portrait before rerolling a derived panel')
      await runPanel(idx, source, portrait.dataUrl)
    } else {
      await runPanel(idx, source, null)
    }
  }

  return { panels, reset, expandAll, rerollPanel }
}
