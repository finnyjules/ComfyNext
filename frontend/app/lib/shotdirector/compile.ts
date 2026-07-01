// frontend/app/lib/shotdirector/compile.ts
// Turns a ShotSheet into a terse, best-practice prompt string (canonical
// Subject→Action→Environment→Camera→Style→References→Dialogue→Constraints
// order) plus the model's Replicate input object, and reports the word budget.
// Deterministic and pure — pinned by golden tests.

import {
  CAMERA_MOVE_PHRASE, ROLE_PURPOSE, SHOT_TYPE_PHRASE,
  type Beat, type ShotSheet,
} from './types'
import { validateShotSheet, type RefCaps, type ValidationIssue } from './rules'
import type { ModelInput, ModelProfile } from './profiles'

export interface CompileResult {
  prompt: string
  input: ModelInput
  wordCount: number
  issues: ValidationIssue[]
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s
}

/** "Medium shot, slow push-in." for the shot's single camera line. */
function cameraLine(shotType: ShotSheet['camera']['shotType'], move: ShotSheet['camera']['move'], pacing: string): string {
  return `${SHOT_TYPE_PHRASE[shotType]}, ${pacing} ${CAMERA_MOVE_PHRASE[move]}.`
}

/** "[0s] Wide shot, smooth locked-off, static camera. She walks to the bar." */
function beatLine(sheet: ShotSheet, b: Beat): string {
  const shotType = b.shotType ?? sheet.camera.shotType
  const move = b.move ?? sheet.camera.move
  const pacing = b.pacing ?? sheet.camera.pacing
  const cam = `${SHOT_TYPE_PHRASE[shotType]}, ${pacing} ${CAMERA_MOVE_PHRASE[move]}.`
  const action = b.action.trim().replace(/\.$/, '')
  return `[${b.startS}s] ${cam} ${capitalize(action)}.`
}

/** "Use [Image1] for …; [Video1] for …." — reference mode only. */
function referenceSentence(sheet: ShotSheet, profile: ModelProfile): string {
  if (sheet.mode !== 'reference' || sheet.references.length === 0) return ''
  const parts = [...sheet.references]
    .sort((a, b) => (a.kind.localeCompare(b.kind) || a.slot - b.slot))
    .map(r => {
      const purpose = ROLE_PURPOSE[r.role]
      const note = r.note ? ` (${r.note.trim()})` : ''
      return `${profile.refTag(r.kind, r.slot)} for ${purpose}${note}`
    })
  return `Use ${parts.join('; ')}.`
}

function dialogueSentence(sheet: ShotSheet): string {
  const lines = sheet.audio.dialogue ?? []
  if (lines.length === 0) return ''
  return lines
    .map(d => (d.speaker ? `${d.speaker}: "${d.line.trim()}"` : `"${d.line.trim()}"`))
    .join(' ')
}

export function buildPrompt(sheet: ShotSheet, profile: ModelProfile): string {
  const segments: string[] = []

  // Subject + Action + Environment.
  const subject = sheet.subject.trim()
  const action = sheet.action.trim().replace(/\.$/, '')
  const env = sheet.environment.trim()
  let opener = subject
  if (action) opener = opener ? `${opener} ${action}` : capitalize(action)
  if (env) opener = opener ? `${opener}, in ${env}.` : `In ${env}.`
  else if (opener) opener = `${opener}.`
  if (opener) segments.push(opener)

  // Lighting + Style.
  const look = [sheet.lighting.trim(), sheet.style.trim()].filter(Boolean)
  if (look.length) {
    look[0]! = capitalize(look[0]!)
    segments.push(`${look.join('; ')}.`)
  }

  // Camera — timed beats replace the single camera line when present.
  if (sheet.beats.length > 0) {
    for (const b of sheet.beats) segments.push(beatLine(sheet, b))
  } else {
    segments.push(cameraLine(sheet.camera.shotType, sheet.camera.move, sheet.camera.pacing))
  }

  // References, Dialogue, Constraints.
  const refs = referenceSentence(sheet, profile)
  if (refs) segments.push(refs)
  const dlg = dialogueSentence(sheet)
  if (dlg) segments.push(dlg)
  if (sheet.constraints.length) segments.push(`Avoid ${sheet.constraints.join(', ')}.`)

  return segments.join(' ')
}

export function compileShot(sheet: ShotSheet, profile: ModelProfile): CompileResult {
  const caps: RefCaps = {
    maxRefImages: profile.maxRefImages,
    maxRefVideos: profile.maxRefVideos,
    maxRefAudios: profile.maxRefAudios,
    supportsFirstLastFrame: profile.supportsFirstLastFrame,
  }
  const issues = validateShotSheet(sheet, caps)
  const prompt = buildPrompt(sheet, profile)
  const wordCount = countWords(prompt)

  if (wordCount > profile.wordBudgetHard) {
    issues.push({ level: 'error', code: 'word-budget-exceeded', message: `Prompt is ${wordCount} words; the limit is ${profile.wordBudgetHard}.` })
  } else if (wordCount > profile.wordBudgetWarn) {
    issues.push({ level: 'warning', code: 'word-budget-warning', message: `Prompt is ${wordCount} words; best practice is under ${profile.wordBudgetWarn}.` })
  }

  const input = profile.buildInput(sheet, prompt)
  return { prompt, input, wordCount, issues }
}
