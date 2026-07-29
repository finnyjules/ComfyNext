import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Guards against the crash class that broke the Compositor for every document with a
 * wired slot (fixed in 60f390912):
 *
 *   watch(needsLiveLoop, startLive)   // Vue evaluates a watch SOURCE during setup,
 *                                     // even without immediate:true
 *     → needsWallClock → hasAnimatedFill → buildStackItems() → hiddenWired
 *                                     // ...declared 21 lines LATER ⇒ temporal dead zone
 *
 * A `const` reached during setup but declared further down throws
 * "Cannot access 'X' before initialization", which kills the whole component. It is
 * invisible to the type checker and to any test that does not mount the component with
 * the exact data shape that reaches the offending branch.
 *
 * So this checks the property that actually matters — lexical order — by walking the
 * transitive reads of every setup-evaluated watch source.
 */

const SRC = fileURLToPath(new URL('../../app/components/vue-canvas/CompositorModal.vue', import.meta.url))

interface Binding { name: string; line: number; hoisted: boolean; body: string }

/** Top-level bindings in a `<script setup>` block, plus the lines they span. */
export function analyseSetup(source: string) {
  const script = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
  const lines = script.split('\n')

  // Column-0 declarations only: nested ones are not in the setup TDZ we care about.
  const DECL = /^(const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/
  const bindings = new Map<string, Binding>()
  const starts: Array<{ name: string; line: number; hoisted: boolean }> = []

  lines.forEach((text, i) => {
    const m = text.match(DECL)
    if (!m) return
    starts.push({ name: m[2]!, line: i, hoisted: m[1]!.includes('function') })
  })

  // A binding's body is its OWN statement, found by balancing delimiters — not
  // everything up to the next declaration. Taking the latter swallows unrelated
  // top-level code (notably `watch` CALLBACKS, which do not run during setup) and
  // produces false positives.
  starts.forEach((s) => {
    let depth = 0
    let end = s.line
    for (let i = s.line; i < lines.length; i++) {
      for (const ch of lines[i]!) {
        if ('([{'.includes(ch)) depth++
        else if (')]}'.includes(ch)) depth--
      }
      end = i
      if (depth <= 0) break
    }
    bindings.set(s.name, {
      name: s.name, line: s.line, hoisted: s.hoisted,
      body: lines.slice(s.line, end + 1).join('\n'),
    })
  })

  // `watch(ident, …)` / `watch(ident,` at column 0 — its source is read during setup.
  const setupWatches: Array<{ source: string; line: number }> = []
  lines.forEach((text, i) => {
    const m = text.match(/^watch\(\s*([A-Za-z_$][\w$]*)\s*,/)
    if (m && bindings.has(m[1]!)) setupWatches.push({ source: m[1]!, line: i })
  })

  return { bindings, setupWatches }
}

/** Every non-hoisted binding transitively reachable from `start`. */
export function reachableBindings(start: string, bindings: Map<string, Binding>): Set<string> {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    const name = stack.pop()!
    if (seen.has(name)) continue
    seen.add(name)
    const b = bindings.get(name)
    if (!b) continue
    for (const ident of b.body.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      if (ident !== name && bindings.has(ident) && !seen.has(ident)) stack.push(ident)
    }
  }
  seen.delete(start)
  return seen
}

export function findTdzViolations(source: string) {
  const { bindings, setupWatches } = analyseSetup(source)
  const bad: string[] = []
  for (const w of setupWatches) {
    for (const name of reachableBindings(w.source, bindings)) {
      const b = bindings.get(name)!
      if (!b.hoisted && b.line > w.line) {
        bad.push(`watch(${w.source}) on line ${w.line + 1} reaches '${name}', declared later on line ${b.line + 1}`)
      }
    }
  }
  return bad
}

describe('setup-time TDZ analyser', () => {
  // Verify the checker against a deliberately broken control — a checker that cannot
  // fail proves nothing.
  const broken = `<script setup lang="ts">
const stackKeys = computed(() => [])
function buildStackItems() {
  return stackKeys.value.map(() => hiddenWired.value.has(1))
}
const hasAnimatedFill = computed(() => buildStackItems())
const needsLiveLoop = computed(() => hasAnimatedFill.value)
function startLive() {}
watch(needsLiveLoop, startLive)
const hiddenWired = computed(() => new Set())
</script>`

  it('catches a computed read during setup but declared later', () => {
    const bad = findTdzViolations(broken)
    expect(bad.length).toBeGreaterThan(0)
    expect(bad.join(' ')).toContain('hiddenWired')
  })

  it('passes once the declaration is hoisted above the watch', () => {
    const fixed = broken.replace('const hiddenWired = computed(() => new Set())\n', '')
      .replace('const stackKeys', 'const hiddenWired = computed(() => new Set())\nconst stackKeys')
    expect(findTdzViolations(fixed)).toEqual([])
  })

  it('does not flag hoisted function declarations', () => {
    const withLateFn = `<script setup lang="ts">
const a = computed(() => later())
watch(a, () => {})
function later() { return 1 }
</script>`
    expect(findTdzViolations(withLateFn)).toEqual([])
  })
})

/**
 * Scope note: `findTdzViolations` follows identifiers textually, so it cannot tell an
 * EAGER read from one inside a closure that runs later. On the real component it flags
 * `wiredMaskEls` (read inside `drawWiredLayer`, called at paint time) and two reads from
 * `baseAspect` — all deferred, all false positives. Distinguishing them needs a real
 * parser, and a gate that cries wolf gets disabled.
 *
 * So the checked property below is the narrow, provable one: the computeds the live-loop
 * chain reads EAGERLY are declared before the watch that triggers it. That is exactly
 * what regressed, and it has no false positives.
 */
describe('CompositorModal setup order', () => {
  const source = readFileSync(SRC, 'utf8')

  it('declares hiddenWired/lockedWired before the watch that reads them at setup', () => {
    const { bindings, setupWatches } = analyseSetup(source)
    const liveLoop = setupWatches.find(w => w.source === 'needsLiveLoop')
    expect(liveLoop, 'watch(needsLiveLoop, …) not found — did the live-loop wiring move?').toBeDefined()

    for (const name of ['hiddenWired', 'lockedWired']) {
      const b = bindings.get(name)
      expect(b, `${name} not found as a top-level binding`).toBeDefined()
      expect(
        b!.line,
        `${name} is declared on line ${b!.line + 1}, after watch(needsLiveLoop) on line ${liveLoop!.line + 1}. `
        + 'That watch evaluates its source during setup and reaches buildStackItems → the wired '
        + 'branch, so this throws "Cannot access before initialization" for any document with a '
        + 'wired slot and the Compositor never opens.',
      ).toBeLessThan(liveLoop!.line)
    }
  })

  it('actually analysed the component — guards against a silently empty parse', () => {
    const { bindings, setupWatches } = analyseSetup(source)
    expect(bindings.size).toBeGreaterThan(100)
    expect(setupWatches.length).toBeGreaterThan(0)
  })
})
