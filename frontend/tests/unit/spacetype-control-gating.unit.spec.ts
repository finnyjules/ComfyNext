import { describe, it, expect } from 'vitest'
import { showIfVisible } from '../../app/lib/studio/sections'
import { coilEffect } from '../../app/lib/spacetype/effects/coil'
import { cylinderEffect } from '../../app/lib/spacetype/effects/cylinder'
import { fieldEffect } from '../../app/lib/spacetype/effects/field'
import { ribbonEffect } from '../../app/lib/spacetype/effects/ribbon'
import { boostEffect } from '../../app/lib/spacetype/effects/boost'
import { sliceGlitchEffect } from '../../app/lib/spacetype/effects/sliceGlitch'
import { ballEffect } from '../../app/lib/spacetype/effects/ball'
import { blendEffect } from '../../app/lib/spacetype/effects/blend'
import { cascadeEffect } from '../../app/lib/spacetype/effects/cascade'
import { cornerPinEffect } from '../../app/lib/spacetype/effects/cornerPin'
import { echoEffect } from '../../app/lib/spacetype/effects/echo'
import { meltEffect } from '../../app/lib/spacetype/effects/melt'
import { onionburstEffect } from '../../app/lib/spacetype/effects/onionburst'
import { shutterEffect } from '../../app/lib/spacetype/effects/shutter'
import { streamerEffect } from '../../app/lib/spacetype/effects/streamer'
import { stringEffect } from '../../app/lib/spacetype/effects/string'

// Real exports are `coilEffect`/`cylinderEffect`/`fieldEffect`/`ribbonEffect` (SpaceTypeEffect
// objects with a `.controls` array), not bare `coil`/`cylinder`/`field`/`ribbon` — the brief's
// sketch import assumed the latter; adjusted here to match the actual module shape.
const EFFECTS = { coil: coilEffect, cylinder: cylinderEffect, field: fieldEffect, ribbon: ribbonEffect } as Record<string, any>
const SHADOW_DEPS = ['shadowStrength', 'shadowSoftness', 'lightAngleX', 'lightAngleY']

describe('shadow controls hide when shadows are off', () => {
  for (const [name, eff] of Object.entries(EFFECTS)) {
    it(`${name}: shadow deps gated on the shadows toggle`, () => {
      const controls = eff.controls as any[]
      const toggle = controls.find(c => c.key === 'shadows')
      expect(toggle, `${name} has a shadows toggle`).toBeTruthy()
      const offVal = toggle.kind === 'switch' ? false : 'off'
      const onVal = toggle.kind === 'switch' ? true : 'on'
      for (const dep of SHADOW_DEPS) {
        const c = controls.find(x => x.key === dep)
        expect(c, `${name}.${dep} exists`).toBeTruthy()
        expect(c.showIf, `${name}.${dep} has showIf`).toBeTruthy()
        expect(showIfVisible(c, (k) => (k === 'shadows' ? offVal : undefined))).toBe(false)
        expect(showIfVisible(c, (k) => (k === 'shadows' ? onVal : undefined))).toBe(true)
      }
    })
  }
})

/**
 * boost's side/extrude/stroke controls are gated per-mode. Source-verified against
 * lib/spacetype/effects/boost.ts's resolveSide/pickStyle/update: `ombre` unconditionally
 * reads palette[0] (and palette[1] when paletteCount>1) to build its dither texture — a
 * detail the task brief's literal `in` list for boostColor1..6 missed — so boostColor1
 * and boostColor2 (but not 3..6, which ombre never indexes) also show for `sideMode:
 * 'ombre'`. See task-3-report.md for the full reconciliation.
 */
describe('boost: mode-specific controls gated', () => {
  const controls = boostEffect.controls as any[]
  const byKey = (key: string) => {
    const c = controls.find(x => x.key === key)
    expect(c, `boost.${key} exists`).toBeTruthy()
    expect(c.showIf, `boost.${key} has showIf`).toBeTruthy()
    return c
  }
  const readWith = (key: string, value: unknown) => (k: string) => (k === key ? (value as any) : undefined)

  it('extrudeMode: punchDistance only in punch mode', () => {
    const c = byKey('punchDistance')
    expect(showIfVisible(c, readWith('extrudeMode', 'static'))).toBe(false)
    expect(showIfVisible(c, readWith('extrudeMode', 'tumble'))).toBe(false)
    expect(showIfVisible(c, readWith('extrudeMode', 'zoom'))).toBe(false)
    expect(showIfVisible(c, readWith('extrudeMode', 'punch'))).toBe(true)
  })

  it('extrudeMode: holdFraction hidden only in static mode', () => {
    const c = byKey('holdFraction')
    expect(showIfVisible(c, readWith('extrudeMode', 'static'))).toBe(false)
    expect(showIfVisible(c, readWith('extrudeMode', 'tumble'))).toBe(true)
    expect(showIfVisible(c, readWith('extrudeMode', 'zoom'))).toBe(true)
    expect(showIfVisible(c, readWith('extrudeMode', 'punch'))).toBe(true)
  })

  it('extrudeMode: tumble hidden only in zoom mode (unused there per update())', () => {
    const c = byKey('tumble')
    expect(showIfVisible(c, readWith('extrudeMode', 'zoom'))).toBe(false)
    expect(showIfVisible(c, readWith('extrudeMode', 'static'))).toBe(true)
    expect(showIfVisible(c, readWith('extrudeMode', 'tumble'))).toBe(true)
    expect(showIfVisible(c, readWith('extrudeMode', 'punch'))).toBe(true)
  })

  it('sideMode: sideColor only in solid mode', () => {
    const c = byKey('sideColor')
    expect(showIfVisible(c, readWith('sideMode', 'solid'))).toBe(true)
    expect(showIfVisible(c, readWith('sideMode', 'gradient'))).toBe(false)
  })

  it('sideMode: gridCell/gridLine only in grid mode', () => {
    for (const key of ['gridCell', 'gridLine']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('sideMode', 'grid'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'solid'))).toBe(false)
    }
  })

  it('sideMode: noiseColor1/noiseColor2 only in noise mode', () => {
    for (const key of ['noiseColor1', 'noiseColor2']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('sideMode', 'noise'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'solid'))).toBe(false)
    }
  })

  // pickStyle() lets `mixed` (random per letter) and `custom` (per-letter list, default
  // 'rainbow, grid, noise, solid') select solid/grid/noise letters, so their colour controls
  // must stay visible in those two modes too — not just their own single-style mode.
  it('sideMode: sideColor/gridCell/gridLine/noiseColor1/noiseColor2 also visible in mixed and custom (pickStyle can select solid/grid/noise there)', () => {
    for (const key of ['sideColor', 'gridCell', 'gridLine', 'noiseColor1', 'noiseColor2']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('sideMode', 'mixed'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'custom'))).toBe(true)
    }
  })

  it('sideMode: sideColor/gridCell/gridLine/noiseColor1/noiseColor2 still visible in their own base mode and still hidden for unrelated single modes', () => {
    expect(showIfVisible(byKey('sideColor'), readWith('sideMode', 'solid'))).toBe(true)
    expect(showIfVisible(byKey('sideColor'), readWith('sideMode', 'noise'))).toBe(false)
    for (const key of ['gridCell', 'gridLine']) {
      expect(showIfVisible(byKey(key), readWith('sideMode', 'grid'))).toBe(true)
      expect(showIfVisible(byKey(key), readWith('sideMode', 'solid'))).toBe(false)
    }
    for (const key of ['noiseColor1', 'noiseColor2']) {
      expect(showIfVisible(byKey(key), readWith('sideMode', 'noise'))).toBe(true)
      expect(showIfVisible(byKey(key), readWith('sideMode', 'grid'))).toBe(false)
    }
  })

  it('sideMode: letterStyles only in custom mode', () => {
    const c = byKey('letterStyles')
    expect(showIfVisible(c, readWith('sideMode', 'custom'))).toBe(true)
    expect(showIfVisible(c, readWith('sideMode', 'mixed'))).toBe(false)
  })

  it('sideMode: boostColor1/boostColor2 visible for palette/gradient/ombre/mixed/custom, hidden for solid/rainbow/grid/noise', () => {
    for (const key of ['boostColor1', 'boostColor2']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('sideMode', 'solid'))).toBe(false)
      expect(showIfVisible(c, readWith('sideMode', 'gradient'))).toBe(true)
      // ombre's resolveSide() unconditionally builds its dither texture from palette[0]/[1].
      expect(showIfVisible(c, readWith('sideMode', 'ombre'))).toBe(true)
    }
  })

  it('sideMode: boostColor3..6 and paletteCount hidden for ombre (never indexed there)', () => {
    for (const key of ['boostColor3', 'boostColor4', 'boostColor5', 'boostColor6', 'paletteCount']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('sideMode', 'palette'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'gradient'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'mixed'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'custom'))).toBe(true)
      expect(showIfVisible(c, readWith('sideMode', 'ombre'))).toBe(false)
      expect(showIfVisible(c, readWith('sideMode', 'solid'))).toBe(false)
    }
  })

  it('stroke: strokeColor/strokeWidth only when stroke is on', () => {
    for (const key of ['strokeColor', 'strokeWidth']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('stroke', 'off'))).toBe(false)
      expect(showIfVisible(c, readWith('stroke', 'on'))).toBe(true)
    }
  })
})

/**
 * sliceGlitch's ~19 mode-specific controls, gated per source (draw()/motion() in
 * lib/spacetype/effects/sliceGlitch.ts, blockSegments() in ../sliceGlitchLayout.ts):
 *  - revealMode 'hold' short-circuits motion() to only read glitchAmount; the 'animate'
 *    branch reads speed/sceneCount/sceneTransition/ease via sceneMotion(), and transitionTear
 *    only multiplies a nonzero `burst` which sceneMotion (animate-only) ever produces.
 *  - fontVaryUnit === 'off' sets unitId = -1, so fontJitter() (and therefore weightJitter/
 *    slantJitter/fontSeed) is never invoked; any other value drives it.
 *  - blockUnit routes to blockSegments(): only the 'random' branch calls segmentRow(...,
 *    density, ...), so blockDensity is read only there.
 *  - doodlesOn is a 'select' (['on','off']), not a switch; draw() gates the whole doodle
 *    pass behind `String(p.doodlesOn) === 'on'`.
 */
describe('sliceGlitch: mode-specific controls gated', () => {
  const controls = sliceGlitchEffect.controls as any[]
  const byKey = (key: string) => {
    const c = controls.find(x => x.key === key)
    expect(c, `sliceGlitch.${key} exists`).toBeTruthy()
    expect(c.showIf, `sliceGlitch.${key} has showIf`).toBeTruthy()
    return c
  }
  const readWith = (key: string, value: unknown) => (k: string) => (k === key ? (value as any) : undefined)

  it('revealMode: speed/sceneCount/sceneTransition/transitionTear/ease shown only in animate', () => {
    for (const key of ['speed', 'sceneCount', 'sceneTransition', 'transitionTear', 'ease']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('revealMode', 'animate'))).toBe(true)
      expect(showIfVisible(c, readWith('revealMode', 'hold'))).toBe(false)
    }
  })

  it('revealMode: glitchAmount ("Glitch (hold)") shown only in hold', () => {
    const c = byKey('glitchAmount')
    expect(showIfVisible(c, readWith('revealMode', 'hold'))).toBe(true)
    expect(showIfVisible(c, readWith('revealMode', 'animate'))).toBe(false)
  })

  it('fontVaryUnit: weightJitter/slantJitter/fontSeed hidden only when off', () => {
    for (const key of ['weightJitter', 'slantJitter', 'fontSeed']) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('fontVaryUnit', 'off'))).toBe(false)
      expect(showIfVisible(c, readWith('fontVaryUnit', 'line'))).toBe(true)
      expect(showIfVisible(c, readWith('fontVaryUnit', 'word'))).toBe(true)
      expect(showIfVisible(c, readWith('fontVaryUnit', 'character'))).toBe(true)
    }
  })

  it('blockUnit: blockDensity shown only when random', () => {
    const c = byKey('blockDensity')
    expect(showIfVisible(c, readWith('blockUnit', 'random'))).toBe(true)
    expect(showIfVisible(c, readWith('blockUnit', 'line'))).toBe(false)
    expect(showIfVisible(c, readWith('blockUnit', 'word'))).toBe(false)
    expect(showIfVisible(c, readWith('blockUnit', 'character'))).toBe(false)
  })

  it('doodlesOn: all 9 doodle controls hidden when off, visible when on', () => {
    const DOODLE_KEYS = [
      'doodleCount', 'doodleSize', 'doodleSizeJitter', 'doodleAreaW', 'doodleAreaH',
      'doodleColorMode', 'doodleWidth', 'doodleStroke', 'doodleStrokeColor',
    ]
    for (const key of DOODLE_KEYS) {
      const c = byKey(key)
      expect(showIfVisible(c, readWith('doodlesOn', 'off'))).toBe(false)
      expect(showIfVisible(c, readWith('doodlesOn', 'on'))).toBe(true)
    }
  })
})

/**
 * Task 5a: ball/blend/cascade/cornerPin/echo — mode-specific controls gated per source.
 *  - ball: panelMode 'per-word' derives its panel count from `around` and never reads
 *    `segments` (buildScene); shading 'flat' uses MeshBasicMaterial and never reads
 *    `shadeStrength` (only spent building the 'lit' ambient light).
 *  - blend: style 'solid' passes strokeWidth 0 into layoutChars regardless of the control
 *    (outline ? strokeWidth : 0) — the control only matters for 'outline'.
 *  - cascade: noStripes 'on' skips building any ribbon mesh at all (both the fast-path and
 *    the split-per-fill-slot path are gated on `!noStripes`), so gradientMode's flag is
 *    never read when stripes are off.
 *  - cornerPin: mode 'static' keeps cur=nxt=0, e=0 in update(), so only scene-0's pose
 *    (built from `skew`) is used; scenes/holdTime/transitionTime/ease/sway/seed never
 *    reach the render in that branch.
 *  - echo: showBox 'off' forces the card material to colorWrite=false/opacity=1
 *    (cardColor/cardOpacity are never applied) in update()'s placeCopy().
 */
describe('task-5a: ball/blend/cascade/cornerPin/echo mode-specific controls gated', () => {
  const byKey = (controls: any[], effectName: string, key: string) => {
    const c = controls.find(x => x.key === key)
    expect(c, `${effectName}.${key} exists`).toBeTruthy()
    expect(c.showIf, `${effectName}.${key} has showIf`).toBeTruthy()
    return c
  }
  const readWith = (key: string, value: unknown) => (k: string) => (k === key ? (value as any) : undefined)

  it('ball: segments shown only for panelMode=fixed', () => {
    const c = byKey(ballEffect.controls as any[], 'ball', 'segments')
    expect(showIfVisible(c, readWith('panelMode', 'per-word'))).toBe(false)
    expect(showIfVisible(c, readWith('panelMode', 'fixed'))).toBe(true)
  })

  it('ball: shadeStrength shown only for shading=lit', () => {
    const c = byKey(ballEffect.controls as any[], 'ball', 'shadeStrength')
    expect(showIfVisible(c, readWith('shading', 'flat'))).toBe(false)
    expect(showIfVisible(c, readWith('shading', 'lit'))).toBe(true)
  })

  it('blend: strokeWidth shown only for style=outline', () => {
    const c = byKey(blendEffect.controls as any[], 'blend', 'strokeWidth')
    expect(showIfVisible(c, readWith('style', 'solid'))).toBe(false)
    expect(showIfVisible(c, readWith('style', 'outline'))).toBe(true)
  })

  it('cascade: gradientMode shown only when noStripes=off', () => {
    const c = byKey(cascadeEffect.controls as any[], 'cascade', 'gradientMode')
    expect(showIfVisible(c, readWith('noStripes', 'on'))).toBe(false)
    expect(showIfVisible(c, readWith('noStripes', 'off'))).toBe(true)
  })

  it('cornerPin: scenes/holdTime/transitionTime/ease/sway/seed shown only for mode=loop', () => {
    const controls = cornerPinEffect.controls as any[]
    for (const key of ['scenes', 'holdTime', 'transitionTime', 'ease', 'sway', 'seed']) {
      const c = byKey(controls, 'cornerPin', key)
      expect(showIfVisible(c, readWith('mode', 'static'))).toBe(false)
      expect(showIfVisible(c, readWith('mode', 'loop'))).toBe(true)
    }
  })

  it('echo: cardColor/cardOpacity shown only when showBox=on', () => {
    const controls = echoEffect.controls as any[]
    for (const key of ['cardColor', 'cardOpacity']) {
      const c = byKey(controls, 'echo', key)
      expect(showIfVisible(c, readWith('showBox', 'off'))).toBe(false)
      expect(showIfVisible(c, readWith('showBox', 'on'))).toBe(true)
    }
  })
})

/**
 * Task 5b: melt/onionburst/shutter/streamer/string — mode-specific controls gated per source.
 *  - melt: uGeo (waveStyle==='geometric' ? 1 : 0) only gates uSteps's use in the fragment
 *    shader — steps is otherwise a dead uniform, so it's shown only for 'geometric'.
 *  - onionburst: tumbleMotion !== 'static' is the only branch in update() that reads
 *    holdFraction (via the grow-in/hold/retract envelope); 'static' holds full tumble with
 *    no envelope at all.
 *  - shutter: copyColor() in the fragment shader switches on uColorMode — mono reads
 *    uTextColor, palette reads uPalA/uPalB, fill reads the fill atlas — so textColor/
 *    paletteA/paletteB/fill are each live in exactly one colorMode. sceneBlend() short-
 *    circuits to {cur:0,nxt:0,e:0} when mode==='static', and shutterPose(0,...) returns
 *    early without reading variance/seed — so scenes/variance/holdTime/transitionTime/
 *    ease/seed are all dead outside mode==='loop'.
 *  - streamer: the front face's FACE_FRAG only samples `base` (built from frontMode/fills)
 *    when uNoStripes<=0.5; noStripes==='on' discards or paints solid uTextColor instead, so
 *    frontMode/fills are dead there. backColorB feeds every non-solid back mode (gradient/
 *    ombre/grid/noise all read fill.b) but backDensity only reaches gridTex's cell count
 *    (ombreTex/noiseTex/gradientRamp take no density argument) — so backDensity is gated
 *    tighter (equals 'grid') than backColorB (notEquals 'solid'), a deliberate deviation
 *    from the audit's uniform notEquals:'solid' for both, verified against fills.ts.
 *  - string: buildTile()'s switch (../stringTextures.ts) — 'text' reads fore + knots[0];
 *    'stripes' reads fore + knots[0]; 'grad1'/'grad2' read all five knots (knots[0..4]).
 *    g1 (knots[0]) is read by every mode, so it is left ungated. Mixture per strip/string
 *    cycle text→grad1→stripes→grad2 by index, so any tile kind may appear — both Mixture
 *    options are included in every gate rather than assumed absent.
 */
describe('task-5b: melt/onionburst/shutter/streamer/string mode-specific controls gated', () => {
  const byKey = (controls: any[], effectName: string, key: string) => {
    const c = controls.find(x => x.key === key)
    expect(c, `${effectName}.${key} exists`).toBeTruthy()
    expect(c.showIf, `${effectName}.${key} has showIf`).toBeTruthy()
    return c
  }
  const readWith = (key: string, value: unknown) => (k: string) => (k === key ? (value as any) : undefined)

  it('melt: steps shown only for waveStyle=geometric', () => {
    const c = byKey(meltEffect.controls as any[], 'melt', 'steps')
    expect(showIfVisible(c, readWith('waveStyle', 'smooth'))).toBe(false)
    expect(showIfVisible(c, readWith('waveStyle', 'geometric'))).toBe(true)
  })

  it('onionburst: holdFraction shown only for tumbleMotion=animate', () => {
    const c = byKey(onionburstEffect.controls as any[], 'onionburst', 'holdFraction')
    expect(showIfVisible(c, readWith('tumbleMotion', 'static'))).toBe(false)
    expect(showIfVisible(c, readWith('tumbleMotion', 'animate'))).toBe(true)
  })

  it('shutter: colorMode-gated colour controls each shown only in their own mode', () => {
    const controls = shutterEffect.controls as any[]
    const c = byKey(controls, 'shutter', 'textColor')
    expect(showIfVisible(c, readWith('colorMode', 'mono'))).toBe(true)
    expect(showIfVisible(c, readWith('colorMode', 'palette'))).toBe(false)
    expect(showIfVisible(c, readWith('colorMode', 'fill'))).toBe(false)

    for (const key of ['paletteA', 'paletteB']) {
      const p = byKey(controls, 'shutter', key)
      expect(showIfVisible(p, readWith('colorMode', 'palette'))).toBe(true)
      expect(showIfVisible(p, readWith('colorMode', 'mono'))).toBe(false)
      expect(showIfVisible(p, readWith('colorMode', 'fill'))).toBe(false)
    }

    const f = byKey(controls, 'shutter', 'fill')
    expect(showIfVisible(f, readWith('colorMode', 'fill'))).toBe(true)
    expect(showIfVisible(f, readWith('colorMode', 'mono'))).toBe(false)
    expect(showIfVisible(f, readWith('colorMode', 'palette'))).toBe(false)
  })

  it('shutter: scenes/variance/holdTime/transitionTime/ease/seed shown only for mode=loop', () => {
    const controls = shutterEffect.controls as any[]
    for (const key of ['scenes', 'variance', 'holdTime', 'transitionTime', 'ease', 'seed']) {
      const c = byKey(controls, 'shutter', key)
      expect(showIfVisible(c, readWith('mode', 'static'))).toBe(false)
      expect(showIfVisible(c, readWith('mode', 'loop'))).toBe(true)
    }
  })

  it('streamer: frontMode/fills shown only when noStripes=off', () => {
    const controls = streamerEffect.controls as any[]
    for (const key of ['frontMode', 'fills']) {
      const c = byKey(controls, 'streamer', key)
      expect(showIfVisible(c, readWith('noStripes', 'on'))).toBe(false)
      expect(showIfVisible(c, readWith('noStripes', 'off'))).toBe(true)
    }
  })

  it('streamer: backColorB hidden only when backMode=solid', () => {
    const c = byKey(streamerEffect.controls as any[], 'streamer', 'backColorB')
    expect(showIfVisible(c, readWith('backMode', 'solid'))).toBe(false)
    for (const mode of ['gradient', 'ombre', 'grid', 'noise']) {
      expect(showIfVisible(c, readWith('backMode', mode))).toBe(true)
    }
  })

  it('streamer: backDensity shown only when backMode=grid (density is dead in ombre/noise/gradient — fills.ts takes no density arg there)', () => {
    const c = byKey(streamerEffect.controls as any[], 'streamer', 'backDensity')
    expect(showIfVisible(c, readWith('backMode', 'grid'))).toBe(true)
    for (const mode of ['solid', 'gradient', 'ombre', 'noise']) {
      expect(showIfVisible(c, readWith('backMode', mode))).toBe(false)
    }
  })

  it('string: fore shown for Text/Stripes/both Mixture modes, hidden for Gradient 1/Gradient 2', () => {
    const c = byKey(stringEffect.controls as any[], 'string', 'fore')
    expect(showIfVisible(c, readWith('textureMode', 'Text'))).toBe(true)
    expect(showIfVisible(c, readWith('textureMode', 'Stripes'))).toBe(true)
    expect(showIfVisible(c, readWith('textureMode', 'Mixture per strip'))).toBe(true)
    expect(showIfVisible(c, readWith('textureMode', 'Mixture per string'))).toBe(true)
    expect(showIfVisible(c, readWith('textureMode', 'Gradient 1'))).toBe(false)
    expect(showIfVisible(c, readWith('textureMode', 'Gradient 2'))).toBe(false)
  })

  it('string: g1 is read by every buildTile branch (bg/knot0), so it carries no showIf and is always visible', () => {
    const controls = stringEffect.controls as any[]
    const c = controls.find(x => x.key === 'g1')
    expect(c, 'string.g1 exists').toBeTruthy()
    expect(c.showIf).toBeFalsy()
    for (const mode of ['Text', 'Gradient 1', 'Gradient 2', 'Stripes', 'Mixture per strip', 'Mixture per string']) {
      expect(showIfVisible(c, readWith('textureMode', mode))).toBe(true)
    }
  })

  it('string: g2..g5 shown for Gradient 1/Gradient 2/both Mixture modes, hidden for Text/Stripes', () => {
    const controls = stringEffect.controls as any[]
    for (const key of ['g2', 'g3', 'g4', 'g5']) {
      const c = byKey(controls, 'string', key)
      expect(showIfVisible(c, readWith('textureMode', 'Gradient 1'))).toBe(true)
      expect(showIfVisible(c, readWith('textureMode', 'Gradient 2'))).toBe(true)
      expect(showIfVisible(c, readWith('textureMode', 'Mixture per strip'))).toBe(true)
      expect(showIfVisible(c, readWith('textureMode', 'Mixture per string'))).toBe(true)
      expect(showIfVisible(c, readWith('textureMode', 'Text'))).toBe(false)
      expect(showIfVisible(c, readWith('textureMode', 'Stripes'))).toBe(false)
    }
  })
})
