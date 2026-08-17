export interface ShowWhen { uniform: string; equals: number | number[] }
export function matchesShowWhen(showWhen: ShowWhen | undefined, read: (uniform: string) => number): boolean {
  if (!showWhen) return true
  const v = Math.round(read(showWhen.uniform))
  return Array.isArray(showWhen.equals) ? showWhen.equals.includes(v) : v === showWhen.equals
}
