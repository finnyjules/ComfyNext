import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { drawSpaceTypeClip } from '../../app/lib/engine/spaceTypeClipRenderer'
import { createSpaceTypeClip } from '../../app/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'
import { EDIT_STATE_VERSION, type EditState, type SpaceTypeClip } from '../../shared/timeline/types'

// Hoisted so the vi.mock factory below (itself hoisted above these imports)
// can close over them. Real vi.fn() spies, not the plain arrow functions the
// original version of this file used — so tests can assert call counts, not
// just behaviour.
const { acquireSpaceTypeEngine, releaseSpaceTypeEngine } = vi.hoisted(() => ({
  acquireSpaceTypeEngine: vi.fn(() => ({ id: 1 })),
  releaseSpaceTypeEngine: vi.fn(),
}))

vi.mock('../../app/lib/engine/spaceTypeEnginePool', () => ({
  acquireSpaceTypeEngine,
  getSpaceTypeEngine: () => null,          // simulate no engine for this frame
  releaseSpaceTypeEngine,
  structuralKey: () => 'k',
}))

// Imported after the mock so usePlaybackEngine.ts picks up the mocked pool.
import { usePlaybackEngine } from '../../app/composables/usePlaybackEngine'

describe('drawSpaceTypeClip when the engine is unavailable', () => {
  it('draws nothing and does not throw', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
    const drawImage = vi.fn()
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D
    expect(() => drawSpaceTypeClip({ id: 1 }, ctx, clip, 0, 1920, 1080, 30)).not.toThrow()
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('draws nothing when the handle itself is null', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
    const drawImage = vi.fn()
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D
    expect(() => drawSpaceTypeClip(null, ctx, clip, 0, 1920, 1080, 30)).not.toThrow()
    expect(drawImage).not.toHaveBeenCalled()
  })
})

// ── usePlaybackEngine's spacetype branch: acquire-once-lazily, release-on-destroy ──
//
// These exercise the REAL usePlaybackEngine.ts (imported above, after the pool
// mock). Only the pool and DOM surfaces (canvas/document) are faked; the
// composable's own acquire-guard and destroy() logic run unmodified. Run in
// vitest's node environment: no DOM, no WebGL, so `drawFrame()` (the
// composable's exposed per-frame entry point — the same one its rAF loop
// calls) is invoked directly rather than driving a real rAF loop.

/** A stub 2D context: no-op drawing methods, writable style properties, no
 *  real rendering — drawFrame() only needs it to not throw. */
function fakeCtx2D() {
  return {
    save: () => {},
    restore: () => {},
    fillRect: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    drawImage: () => {},
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
  } as unknown as CanvasRenderingContext2D
}

/** A stub canvas whose getContext('2d') returns fakeCtx2D(). */
function fakeCanvas(): HTMLCanvasElement {
  const ctx = fakeCtx2D()
  return {
    width: 0,
    height: 0,
    getContext: (type: string) => (type === '2d' ? ctx : null),
  } as unknown as HTMLCanvasElement
}

function makeState(clips: SpaceTypeClip[]): EditState {
  return {
    version: EDIT_STATE_VERSION,
    canvas: { width: 100, height: 100, fps: 30, bg_color: '#000000' },
    tracks: [
      { id: 'track-1', kind: 'video', name: 'V1', muted: false, locked: false, clips },
    ],
    transitions: [],
    total_frames: 300,
  }
}

/** A spacetype clip active for the first 6s of the timeline (180 frames @ 30fps,
 *  matching defaultSpaceTypeState's fps/loopDuration — see spacetype-clip-render
 *  spec's "6s => 180 source frames" comment). */
function makeSpaceTypeClip(): SpaceTypeClip {
  return createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
}

describe('usePlaybackEngine: spacetype engine acquire/release lifecycle', () => {
  beforeEach(() => {
    acquireSpaceTypeEngine.mockClear()
    releaseSpaceTypeEngine.mockClear()
  })

  it('acquires the spacetype engine lazily and only once, across many rendered frames', () => {
    const state = ref(makeState([makeSpaceTypeClip()]))
    const canvasRef = ref(fakeCanvas())
    const playhead = ref(0)
    const isPlaying = ref(false)
    const engine = usePlaybackEngine(canvasRef, state, playhead, isPlaying, () => null)

    expect(acquireSpaceTypeEngine).not.toHaveBeenCalled() // not acquired just from construction

    // Render several frames, all landing inside the clip's active window
    // (0s..6s) — a naive per-frame acquire (the bug the pool was built to
    // prevent) would call acquireSpaceTypeEngine on every one of these.
    for (const t of [0, 1, 2, 3, 4]) {
      playhead.value = t
      engine.drawFrame()
    }

    expect(acquireSpaceTypeEngine).toHaveBeenCalledTimes(1)
  })

  it('never acquires the spacetype engine when the timeline has no spacetype clips', () => {
    const state = ref(makeState([])) // no clips at all
    const canvasRef = ref(fakeCanvas())
    const playhead = ref(0)
    const isPlaying = ref(false)
    const engine = usePlaybackEngine(canvasRef, state, playhead, isPlaying, () => null)

    for (const t of [0, 1, 2]) {
      playhead.value = t
      engine.drawFrame()
    }

    expect(acquireSpaceTypeEngine).not.toHaveBeenCalled()
    expect(releaseSpaceTypeEngine).not.toHaveBeenCalled()
  })

  it('releases the acquired engine exactly once on destroy()', () => {
    const state = ref(makeState([makeSpaceTypeClip()]))
    const canvasRef = ref(fakeCanvas())
    const playhead = ref(2) // inside the clip's active window
    const isPlaying = ref(false)
    const engine = usePlaybackEngine(canvasRef, state, playhead, isPlaying, () => null)

    engine.drawFrame() // triggers the lazy acquire
    expect(acquireSpaceTypeEngine).toHaveBeenCalledTimes(1)
    const handle = acquireSpaceTypeEngine.mock.results[0]!.value

    expect(releaseSpaceTypeEngine).not.toHaveBeenCalled() // not released before destroy()

    engine.destroy()

    expect(releaseSpaceTypeEngine).toHaveBeenCalledTimes(1)
    expect(releaseSpaceTypeEngine).toHaveBeenCalledWith(handle)
  })
})
