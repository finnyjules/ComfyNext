// Visual check for the Type-Studio colour system brought into Frame:
// multi-stop linear gradient, radial gradient, image tint (fill blended over an
// image and clipped to its alpha), and a doc-level background fill. Ports the
// same canvas math as resolvePaint / drawTintedImage / paintLayerStack's bg.
// Run: node tests/manual/colorsys-screenshot.mjs
import { chromium } from '@playwright/test'

const CW = 260, CH = 220

const html = `<!doctype html><html><head><meta charset=utf8><style>
  body{margin:0;background:#0a0a0a;font:11px -apple-system,sans-serif;color:#888}
  .grid{display:grid;grid-template-columns:repeat(4,${CW}px);gap:1px;background:#1c1c1c}
  .cell{position:relative;width:${CW}px;height:${CH}px;background:#161616}
  .cap{position:absolute;left:8px;top:6px;color:#fff;opacity:.75;z-index:2}
  canvas{display:block}
</style></head><body><div class=grid id=g></div>
<script>
const CW=${CW},CH=${CH}

// ── ported from resolvePaint (gradient branch), centered drawing ──
function gradStyle(ctx, g, w, h){
  const stops=[...g.stops].sort((a,b)=>a.offset-b.offset)
  let cg
  if(g.type==='radial') cg=ctx.createRadialGradient(0,0,0,0,0,Math.max(w,h)/2)
  else { const r=(g.angle*Math.PI)/180, hx=Math.cos(r)*w/2, hy=Math.sin(r)*h/2; cg=ctx.createLinearGradient(-hx,-hy,hx,hy) }
  for(const s of stops) cg.addColorStop(Math.max(0,Math.min(1,s.offset)), s.color)
  return cg
}

// A synthetic "image": opaque blob on transparent, so tint-clip-to-alpha shows.
function makeImage(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d')
  x.fillStyle='#5a6b7a';x.beginPath();x.ellipse(w/2,h/2,w*0.4,h*0.32,0,0,7);x.fill()
  x.fillStyle='#cdd6df';x.font='900 '+Math.round(h*0.4)+'px Arial';x.textAlign='center';x.textBaseline='middle';x.fillText('IMG',w/2,h/2)
  return c}

// ── ported from drawTintedImage ──
function tinted(ctx, img, w, h, tint, blend, op){
  const tw=Math.round(w), th=Math.round(h)
  const off=document.createElement('canvas');off.width=tw;off.height=th;const o=off.getContext('2d')
  o.translate(tw/2,th/2)
  o.drawImage(img,-tw/2,-th/2,tw,th)
  o.globalCompositeOperation=blend; o.globalAlpha=op
  o.fillStyle=gradStyle(o,tint,tw,th); o.fillRect(-tw/2,-th/2,tw,th)
  o.globalAlpha=1; o.globalCompositeOperation='destination-in'; o.drawImage(img,-tw/2,-th/2,tw,th)
  ctx.drawImage(off,-w/2,-h/2,w,h)
}

function cell(title,draw){const d=document.createElement('div');d.className='cell';const cv=document.createElement('canvas');cv.width=CW;cv.height=CH;d.appendChild(cv);const cap=document.createElement('div');cap.className='cap';cap.textContent=title;d.appendChild(cap);draw(cv.getContext('2d'));return d}
const g=document.getElementById('g')
const cx=CW/2,cy=CH/2, BW=190,BH=150

// 1) multi-stop linear gradient (3 stops, 90°)
g.appendChild(cell('Linear · 3 stops',ctx=>{ctx.translate(cx,cy)
  ctx.fillStyle=gradStyle(ctx,{type:'linear',angle:90,stops:[{offset:0,color:'#FF6259'},{offset:0.5,color:'#FFB984'},{offset:1,color:'#F2FF5A'}]},BW,BH)
  ctx.fillRect(-BW/2,-BH/2,BW,BH)}))

// 2) radial gradient
g.appendChild(cell('Radial',ctx=>{ctx.translate(cx,cy)
  ctx.fillStyle=gradStyle(ctx,{type:'radial',stops:[{offset:0,color:'#FF99F7'},{offset:1,color:'#23123C'}]},BW,BH)
  ctx.fillRect(-BW/2,-BH/2,BW,BH)}))

// 3) image tint (gradient multiplied over the blob, clipped to its alpha)
g.appendChild(cell('Image tint · multiply',ctx=>{ctx.translate(cx,cy)
  const img=makeImage(BW,BH)
  tinted(ctx,img,BW,BH,{type:'linear',angle:45,stops:[{offset:0,color:'#0E6BFF'},{offset:1,color:'#54F4CF'}]},'multiply',1)}))

// 4) background fill behind two shapes (bg spans the whole canvas)
g.appendChild(cell('Background fill',ctx=>{
  ctx.save();ctx.translate(CW/2,CH/2)
  ctx.fillStyle=gradStyle(ctx,{type:'linear',angle:120,stops:[{offset:0,color:'#96B4FF'},{offset:1,color:'#52367B'}]},CW,CH)
  ctx.fillRect(-CW/2,-CH/2,CW,CH);ctx.restore()
  ctx.fillStyle='#F2FF5A';ctx.beginPath();ctx.ellipse(90,110,38,38,0,0,7);ctx.fill()
  ctx.fillStyle='#15171b';ctx.fillRect(140,80,80,80)}))
</script></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: CW * 4 + 8, height: CH + 8 } })
await page.setContent(html)
await page.waitForTimeout(250)
const out = new URL('./colorsys-verify.png', import.meta.url).pathname
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log('wrote', out)
