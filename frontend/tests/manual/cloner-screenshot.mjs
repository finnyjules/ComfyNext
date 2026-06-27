// Visual verification harness for the layer cloner. Drives the REAL
// expandClones (app/composables/useCloner.ts, type-stripped by Node) through a
// canvas draw that mirrors drawWiredImageLayer's body, for every mode, then
// screenshots via Playwright. Run: node --experimental-strip-types tests/manual/cloner-screenshot.mjs
import { chromium } from '@playwright/test'
import { expandClones } from '../../app/composables/useCloner.ts'

// Mirror of drawWiredImageLayer's per-clone body — same translate/rotate/scale/alpha.
function drawCloned(ctx, cloner, W, H, paint) {
  for (const c of expandClones(cloner, W / H)) {
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, 1 * c.dopacity))
    ctx.translate(W / 2 + c.dx * W, H / 2 + c.dy * H)
    if (c.drot) ctx.rotate((c.drot * Math.PI) / 180)
    ctx.scale(c.dscale, c.dscale)
    paint(ctx)
    ctx.restore()
  }
}

const CELL = 300
const cfg = (p) => ({
  enabled: true, mode: 'linear', countX: 3, countY: 1, spacingX: 0.25, spacingY: 0.25,
  count: 6, radius: 0.3, startAngle: 0, sweepAngle: 360, faceCenter: false,
  stepRotation: 0, stepScale: 1, stepOpacity: 1, ...p,
})

const cases = [
  ['Linear row (3×, spacingX 0.25)', cfg({ countX: 3, spacingX: 0.25 })],
  ['Mirror X (count 3 → 5 across)', cfg({ countX: 3, spacingX: 0.22, mirrorX: true })],
  ['Mirror X+Y (3×3 → centered block)', cfg({ countX: 3, countY: 3, spacingX: 0.18, spacingY: 0.18, mirrorX: true, mirrorY: true })],
  ['Mirror X + scale falloff (symmetric)', cfg({ countX: 4, spacingX: 0.16, mirrorX: true, stepScale: 0.8, stepOpacity: 0.85 })],
  ['Grid 3×3', cfg({ countX: 3, countY: 3, spacingX: 0.22, spacingY: 0.22 })],
  ['Nudge Y (row → diagonal)', cfg({ countX: 6, spacingX: 0.14, nudgeY: 0.05 })],
  ['Stagger X 0.5 (brick grid)', cfg({ countX: 3, countY: 4, spacingX: 0.22, spacingY: 0.18, staggerX: 0.5 })],
  ['Linear + scale/opacity falloff', cfg({ countX: 5, spacingX: 0.16, stepScale: 0.82, stepOpacity: 0.82 })],
  ['Radial ring (8, faceCenter)', cfg({ mode: 'radial', count: 8, radius: 0.3, sweepAngle: 360, faceCenter: true })],
  ['Radial fan (6, sweep 180, rot falloff)', cfg({ mode: 'radial', count: 6, radius: 0.28, startAngle: -90, sweepAngle: 180, stepRotation: 12 })],
  ['Spiral (radial + scale falloff)', cfg({ mode: 'radial', count: 14, radius: 0.32, sweepAngle: 360, stepScale: 0.9, stepOpacity: 0.95 })],
]

// Build payload: each case rendered offscreen to a data URL via node? Simpler:
// hand the cases to the browser page and draw there with the real expandClones
// transforms precomputed in node (so the browser needs no TS).
const payload = cases.map(([title, cloner]) => ({
  title,
  clones: expandClones(cloner, 1), // square cells → aspect 1
}))

const html = `<!doctype html><html><head><meta charset=utf8><style>
  body{margin:0;background:#0e0e10;font:12px -apple-system,sans-serif;color:#aaa}
  .grid{display:grid;grid-template-columns:repeat(3,${CELL}px);gap:2px}
  .cell{position:relative;width:${CELL}px;height:${CELL}px;background:#161618}
  .cap{position:absolute;left:8px;top:6px;color:#fff;opacity:.7;z-index:2;text-shadow:0 1px 2px #000}
  canvas{display:block}
</style></head><body><div class=grid id=g></div>
<script>
const CELL=${CELL}
const cases=${JSON.stringify(payload)}
const g=document.getElementById('g')
for(const cse of cases){
  const cell=document.createElement('div');cell.className='cell'
  const cap=document.createElement('div');cap.className='cap';cap.textContent=cse.title
  const cv=document.createElement('canvas');cv.width=CELL;cv.height=CELL
  cell.appendChild(cv);cell.appendChild(cap);g.appendChild(cell)
  const ctx=cv.getContext('2d')
  const W=CELL,H=CELL
  // a recognizable "image": a teal rounded rect with an orange arrow so rotation reads
  const paint=(c)=>{
    const w=W*0.22,h=H*0.14
    c.fillStyle='#2dd4bf'
    c.beginPath();c.roundRect(-w/2,-h/2,w,h,6);c.fill()
    c.fillStyle='#fb923c'
    c.beginPath();c.moveTo(w/2,-h/2);c.lineTo(w/2+10,0);c.lineTo(w/2,h/2);c.closePath();c.fill()
  }
  for(const cl of cse.clones){
    ctx.save()
    ctx.globalAlpha=Math.max(0,Math.min(1,cl.dopacity))
    ctx.translate(W/2+cl.dx*W,H/2+cl.dy*H)
    if(cl.drot)ctx.rotate(cl.drot*Math.PI/180)
    ctx.scale(cl.dscale,cl.dscale)
    paint(ctx)
    ctx.restore()
  }
}
</script></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: CELL * 3 + 8, height: CELL * 3 + 8 } })
await page.setContent(html)
await page.waitForTimeout(200)
const out = new URL('./cloner-verify.png', import.meta.url).pathname
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log('wrote', out)
