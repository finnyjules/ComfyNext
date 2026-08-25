import { describe, it, expect } from 'vitest'
import { looksLikeImageIdea } from '~/lib/sketch/sketchIntent'
import { STUDIO_OWNERSHIP_THRESHOLD, studioMatch, studioOwnsPhrase } from '~/lib/agent/studioOwnership'

/**
 * The sketch fast-path must DEFER to studio ownership.
 *
 * Live bug: "a warm dreamy gradient background for a hero banner" on an EMPTY
 * canvas fired the 4-up sketch pad, because `looksLikeImageIdea` returns true
 * for ANY non-question, non-edit-verb text when the graph is empty — and the
 * prompt bar fires `startSketch` on that verdict BEFORE the planner (which
 * routes to GradientStudio) resolves. The gate below is the same capability
 * recall scoring the routing corpus pins (nodeMatch over AGENT_CAPABILITIES),
 * so a phrase a studio decisively owns never fast-paths to sketch.
 */

// Phrases a studio owns — the planner must get them, so NO sketch fast-path.
const STUDIO_OWNED = [
  'a warm dreamy gradient background for a hero banner', // the live bug
  'a seamless terrazzo pattern',
  'kinetic typography that says LAUNCH',
  'a glassy chrome 3d version of the word BLOOM',
  'something calm for a meditation app splash',
  'a tileable geometric wallpaper',
  'a looping mesh gradient in teal and violet',
]

// Genuine image ideas — the fast-path is exactly what these want.
const IMAGE_IDEAS = [
  'a cat wearing a hat',
  'a foggy mountain village at dawn',
  'a lighthouse at dusk',
  'moody cyberpunk alley, neon rain',
  'the dog',
  'a red door',
  'an astronaut riding a horse on mars',
  'a bowl of ramen on a wooden table',
  'portrait of an old fisherman',
  // Nearest miss in the threshold table — a descriptive scene whose words
  // brush a studio's vocabulary ("warm", "night", "windows"). Must still sketch.
  'a snowy street at night with warm windows',
]

describe('studioOwnsPhrase', () => {
  it('claims the phrases a studio owns', () => {
    for (const p of STUDIO_OWNED) expect(studioOwnsPhrase(p), p).toBe(true)
  })
  it('leaves genuine image ideas alone', () => {
    for (const p of IMAGE_IDEAS) expect(studioOwnsPhrase(p), p).toBe(false)
  })
  it('is empty-safe', () => {
    expect(studioOwnsPhrase('')).toBe(false)
    expect(studioOwnsPhrase('   ')).toBe(false)
  })
  it('names the studio it matched', () => {
    const m = studioMatch('a seamless terrazzo pattern')
    expect(m?.nodeType).toBe('TextureStudio')
    expect(m!.score).toBeGreaterThan(STUDIO_OWNERSHIP_THRESHOLD)
  })

  // The threshold is data-derived (see the score table in the report): every
  // studio-owned phrase scores well above it, every genuine image idea well
  // below. This pins the separation so a vocabulary edit that collapses the gap
  // fails HERE rather than in production.
  it('separates the two corpora with clear headroom either side', () => {
    const owned = STUDIO_OWNED.map(p => studioMatch(p)?.score ?? 0)
    const ideas = IMAGE_IDEAS.map(p => studioMatch(p, { ignoreThreshold: true })?.score ?? 0)
    expect(Math.min(...owned)).toBeGreaterThan(STUDIO_OWNERSHIP_THRESHOLD + 1)
    expect(Math.max(...ideas)).toBeLessThan(STUDIO_OWNERSHIP_THRESHOLD - 1)
  })

  // Latency argument: the fast-path exists to skip a ~1s model round trip, so
  // the gate in front of it must be pure local scoring.
  it('is synchronous and does no I/O', () => {
    expect(studioOwnsPhrase.constructor.name).toBe('Function') // not AsyncFunction
    const realFetch = globalThis.fetch
    // @ts-expect-error – deliberately break fetch for the duration of the call
    globalThis.fetch = () => { throw new Error('studioOwnsPhrase must not do I/O') }
    try {
      const out = studioOwnsPhrase('a warm dreamy gradient background for a hero banner')
      expect(typeof out).toBe('boolean')
      expect(out).not.toBeInstanceOf(Promise)
    }
    finally { globalThis.fetch = realFetch }
  })
})

describe('looksLikeImageIdea defers to studio ownership', () => {
  it('does NOT fast-path a studio-owned phrase, empty canvas or not', () => {
    for (const p of STUDIO_OWNED) {
      expect(looksLikeImageIdea(p, true), `${p} (empty graph)`).toBe(false)
      expect(looksLikeImageIdea(p, false), `${p} (populated graph)`).toBe(false)
    }
  })
  it('still fast-paths genuine image ideas on an empty canvas', () => {
    for (const p of IMAGE_IDEAS) expect(looksLikeImageIdea(p, true), p).toBe(true)
  })
})

// Characterization: the pre-existing gate behaviors must survive the change.
describe('looksLikeImageIdea — unchanged behaviors', () => {
  it('rejects questions', () => {
    expect(looksLikeImageIdea('what does this node do?', true)).toBe(false)
    expect(looksLikeImageIdea('how do I export', true)).toBe(false)
  })
  it('rejects graph-edit imperatives', () => {
    expect(looksLikeImageIdea('add a blur node', true)).toBe(false)
    expect(looksLikeImageIdea('make it warmer', true)).toBe(false)
    expect(looksLikeImageIdea('make me a seamless terrazzo pattern', true)).toBe(false) // edit verb 'make'
    expect(looksLikeImageIdea('connect these two', false)).toBe(false)
  })
  it('keeps the 12-word limit on a non-empty graph', () => {
    expect(looksLikeImageIdea('a lighthouse at dusk', false)).toBe(true)
    expect(looksLikeImageIdea('go through every node and set the seed to a fixed value please', false)).toBe(false)
    // 13 descriptive words, non-empty graph → still too long to fast-path.
    expect(looksLikeImageIdea('one two three four five six seven eight nine ten eleven twelve thirteen', false)).toBe(false)
  })
  it('rejects empty input', () => {
    expect(looksLikeImageIdea('   ', true)).toBe(false)
  })
})
