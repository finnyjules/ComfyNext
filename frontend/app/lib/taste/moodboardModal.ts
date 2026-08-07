/**
 * Pure helpers for the Moodboard modal's floating nav (plan
 * 2026-08-06-moodboards-a-core, Task A6). The modal is a brand-guidelines
 * DOCUMENT: one scroll column, no section headers — the floating nav is the
 * only wayfinding, so its active item must track scroll faithfully.
 *
 * An IntersectionObserver reports per-section visibility; `activeSection`
 * turns that report into the active nav id: the FIRST visible section in
 * document order wins (the one whose content the reader is at the top of),
 * and when nothing reports visible (mid-flight between observer callbacks,
 * or a section taller than the viewport with its edges off screen) the
 * previous active id sticks rather than flickering to nothing.
 */
export const sectionIds = ['board', 'reading', 'palette', 'avoids'] as const
export type SectionId = (typeof sectionIds)[number]

export function activeSection(
  scrollStates: { id: string, visible: boolean }[],
  previous?: string,
): string {
  const visible = new Set(scrollStates.filter(s => s.visible).map(s => s.id))
  for (const id of sectionIds) if (visible.has(id)) return id
  return previous || sectionIds[0]
}
