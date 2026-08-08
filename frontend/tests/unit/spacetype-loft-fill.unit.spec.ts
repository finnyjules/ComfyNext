import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { rampFromFill } from '../../app/lib/spacetype/loftGeometry'

const rgbAt = (r: Uint8ClampedArray, i: number) => [r[i*4], r[i*4+1], r[i*4+2]]

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
})
