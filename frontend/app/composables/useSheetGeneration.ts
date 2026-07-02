/**
 * Shared reference-sheet generation machinery: given a source (an uploaded
 * photo or a trained character LoRA) and a fixed scene list, expands each
 * scene into a generated shot. Extracted from CharacterSheetNode.vue so any
 * future sheet-driven surface (e.g. per-variant re-generation) can reuse the
 * same sequential-expand + money-guard behavior instead of re-implementing it.
 *
 * Descriptor-aware: an optional variant `descriptor` (e.g. "shaved head,
 * leather jacket") is threaded into every scene prompt alongside the LoRA
 * trigger, so a sheet can be generated for a specific character variant.
 */
import { ref } from 'vue'
import { useInpaint } from '~/composables/useInpaint'
import type { CharacterShotScene } from '~/data/character-shot-scenes'

export interface SheetShot {
  dataUrl: string | null
  scene: CharacterShotScene
  loading: boolean
  error: boolean
}

export type SheetSource =
  | { mode: 'photo'; referenceImageDataUrl: string; descriptor?: string }
  | { mode: 'lora'; loraFilename: string; trigger: string | null; descriptor?: string }

/**
 * Pure prompt builder: trigger (LoRA identity token), variant descriptor, and
 * the scene prompt itself, comma-joined — falsy pieces (missing trigger, no
 * descriptor) are dropped rather than leaving stray commas.
 */
export function buildScenePrompt(scene: CharacterShotScene, opts: { trigger?: string | null; descriptor?: string }): string {
  return [opts.trigger, opts.descriptor, scene.prompt].filter(Boolean).join(', ')
}

function freshShots(scenes: CharacterShotScene[]): SheetShot[] {
  return scenes.map(scene => ({ dataUrl: null, scene, loading: false, error: false }))
}

export function useSheetGeneration(scenes: CharacterShotScene[]) {
  const { loraGen } = useInpaint()
  const shots = ref<SheetShot[]>(freshShots(scenes))

  function reset() {
    shots.value = freshShots(scenes)
  }

  async function generatePhotoShot(scene: CharacterShotScene, source: Extract<SheetSource, { mode: 'photo' }>): Promise<string> {
    const res = await fetch('/api/cloud-train/character-shot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceImageDataUrl: source.referenceImageDataUrl,
        prompt: buildScenePrompt(scene, { descriptor: source.descriptor }),
        aspectRatio: scene.framing === 'full' ? '3:4' : '1:1',
      }),
    })
    if (!res.ok) throw new Error(`character-shot ${res.status}`)
    const { imageDataUrl } = await res.json() as { imageDataUrl?: string }
    if (!imageDataUrl) throw new Error('no image returned')
    return imageDataUrl
  }

  async function generateLoraShot(scene: CharacterShotScene, source: Extract<SheetSource, { mode: 'lora' }>): Promise<string> {
    const prompt = buildScenePrompt(scene, { trigger: source.trigger, descriptor: source.descriptor })
    const aspectRatio = scene.framing === 'full' ? '3:4' : '1:1'
    const images = await loraGen(source.loraFilename, prompt, aspectRatio)
    const url = images?.[0]
    if (!url) throw new Error('no image returned')
    return url
  }

  async function runShot(idx: number, source: SheetSource) {
    const shot = shots.value[idx]
    if (!shot) return
    shot.loading = true
    shot.error = false
    try {
      const dataUrl = source.mode === 'lora' ? await generateLoraShot(shot.scene, source) : await generatePhotoShot(shot.scene, source)
      shot.dataUrl = dataUrl
    } catch (e) {
      console.warn('[useSheetGeneration] shot failed', e)
      shot.error = true
    } finally {
      shot.loading = false
    }
  }

  async function expandAll(source: SheetSource) {
    // Sequential — concurrency 1 is fine for a small fixed shot set.
    for (let i = 0; i < shots.value.length; i++) {
      await runShot(i, source)
      // Failed shot usually means the rest would fail too — don't spend on them.
      const shot = shots.value[i]
      if (!shot || shot.error) break
    }
  }

  return { shots, reset, runShot, expandAll }
}
