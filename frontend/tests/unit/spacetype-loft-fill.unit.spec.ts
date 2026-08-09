import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { rampFromFill, build2DFillRamp, fillsAngle, stretchAcross } from '../../app/lib/spacetype/loftGeometry'

const rgbAt = (r: Uint8ClampedArray, i: number) => [r[i*4], r[i*4+1], r[i*4+2]]
const px = (r: Uint8ClampedArray, ux: number, vy: number, aSize: number) => {
  const o = (vy*aSize + ux)*4; return [r[o], r[o+1], r[o+2]]
}

describe('rampFromFill — multi-fill spread', () => {
  it('two solids blend: endpoints are the two colours, midpoint between', () => {
    const fills = JSON.stringify([{ type: 'solid', a: '#ff0000' }, { type: 'solid', a: '#0000ff' }])
    const r = rampFromFill(THREE as any, fills, 64, 'blend')
    expect(rgbAt(r, 0)[0]).toBeGreaterThan(200)          // start red
    expect(rgbAt(r, 63)[2]).toBeGreaterThan(200)         // end blue
    const mid = rgbAt(r, 32); expect(mid[0]).toBeGreaterThan(60); expect(mid[2]).toBeGreaterThan(60) // purple-ish
  })
  it('two solids steps: first half solid colour1, second half solid colour2 (hard boundary)', () => {
    const fills = JSON.stringify([{ type: 'solid', a: '#ff0000' }, { type: 'solid', a: '#0000ff' }])
    const r = rampFromFill(THREE as any, fills, 64, 'steps')
    expect(rgbAt(r, 10)).toEqual([255, 0, 0])            // first band pure red
    expect(rgbAt(r, 54)).toEqual([0, 0, 255])            // second band pure blue
    // no purple blend anywhere
    for (let i = 0; i < 64; i++) { const c = rgbAt(r, i); expect(c[0] === 255 || c[2] === 255).toBe(true) }
  })
  it('single ombre blend: a→b gradient (unchanged behaviour)', () => {
    const fills = JSON.stringify([{ type: 'ombre', a: '#000000', b: '#ffffff' }])
    const r = rampFromFill(THREE as any, fills, 64, 'blend')
    const s = rgbAt(r, 0).reduce((a,b)=>a+b,0), e = rgbAt(r, 63).reduce((a,b)=>a+b,0)
    expect(e).toBeGreaterThan(s + 200)
  })
  it('default mode is blend; malformed tolerant', () => {
    expect(rampFromFill(THREE as any, JSON.stringify([{type:'solid',a:'#fff'}]), 32).length).toBe(32*4)
    expect(rampFromFill(THREE as any, 'garbage', 16).length).toBe(16*4)
  })
  it('single solid fill → uniform ramp (1 fill = one colour everywhere)', () => {
    const r = rampFromFill(THREE as any, JSON.stringify([{ type: 'solid', a: '#ff0000' }]), 64, 'blend')
    for (let i = 0; i < 64; i++) expect(rgbAt(r, i)).toEqual([255, 0, 0])
  })
})

describe('build2DFillRamp — 2D across×along', () => {
  const A = 8, L = 16
  it('one gradient fill: uniform ALONG, gradient ACROSS (a→b)', () => {
    const fills = JSON.stringify([{ type: 'gradient', a: '#000000', b: '#ffffff' }])
    const r = build2DFillRamp(THREE as any, fills, 'blend', A, L)
    expect(r.length).toBe(A*L*4)
    // across: left dark, right light; along: same at every row
    expect(px(r, 0, 0, A)[0]).toBeLessThan(40)
    expect(px(r, A-1, 0, A)[0]).toBeGreaterThan(215)
    expect(px(r, A-1, 0, A)).toEqual(px(r, A-1, L-1, A))   // uniform along
  })
  it('[gradient blue→pink, solid white]: first row = gradient, last row = white, middle fades', () => {
    const fills = JSON.stringify([{ type: 'gradient', a: '#3b5bff', b: '#ff2ea6' }, { type: 'solid', a: '#ffffff' }])
    const r = build2DFillRamp(THREE as any, fills, 'blend', A, L)
    // last row all near white
    for (let ux = 0; ux < A; ux++) { const c = px(r, ux, L-1, A); expect(c[0]).toBeGreaterThan(230); expect(c[1]).toBeGreaterThan(230); expect(c[2]).toBeGreaterThan(230) }
    // first row varies across (gradient), not white
    expect(px(r, 0, 0, A)).not.toEqual(px(r, A-1, 0, A))
    // a middle row is lighter than the first row (fading toward white)
    const midSum = px(r, 0, Math.floor(L/2), A).reduce((a,b)=>a+b,0)
    const firstSum = px(r, 0, 0, A).reduce((a,b)=>a+b,0)
    expect(midSum).toBeGreaterThan(firstSum)
  })
  it('steps mode: hard along-band boundary (no fade between the two fills)', () => {
    const fills = JSON.stringify([{ type: 'solid', a: '#ff0000' }, { type: 'solid', a: '#0000ff' }])
    const r = build2DFillRamp(THREE as any, fills, 'steps', A, L)
    expect(px(r, 0, 2, A)).toEqual([255,0,0])       // first band red
    expect(px(r, 0, L-2, A)).toEqual([0,0,255])      // second band blue
  })
})

describe('fillsAngle / stretchAcross', () => {
  it('fillsAngle returns first gradient angle, else 90', () => {
    expect(fillsAngle(JSON.stringify([{type:'gradient',a:'#000',b:'#fff',angle:45}]))).toBe(45)
    expect(fillsAngle(JSON.stringify([{type:'solid',a:'#fff'}]))).toBe(90)
    expect(fillsAngle('garbage')).toBe(90)
  })
  it('stretchAcross replicates a 1-D along ramp across every column', () => {
    const along = new Uint8ClampedArray([10,20,30,255, 40,50,60,255])   // 2 along pixels
    const r = stretchAcross(along, 4)
    expect(r.length).toBe(4*2*4)
    // row 0 (along px0) every column = [10,20,30]
    for (let ux=0; ux<4; ux++) { const o=(0*4+ux)*4; expect([r[o],r[o+1],r[o+2]]).toEqual([10,20,30]) }
  })
})
