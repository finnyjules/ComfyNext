// Visual verification for layer slant + corner-pin/perspective. Renders a content
// tile (checker + "Aa") then: identity, slant (affine shear), perspective trapezoid,
// and an arbitrary corner-pin quad — using the SAME homography/triangle warp as
// lib/compositor/warp.ts (math unit-tested separately). Screenshots via Playwright.
// Run: node tests/manual/warp-screenshot.mjs
import { chromium } from '@playwright/test'

const CW = 260, CH = 240

const html = `<!doctype html><html><head><meta charset=utf8><style>
  body{margin:0;background:#0a0a0a;font:11px -apple-system,sans-serif;color:#888}
  .grid{display:grid;grid-template-columns:repeat(4,${CW}px);gap:1px;background:#1c1c1c}
  .cell{position:relative;width:${CW}px;height:${CH}px;background:#161616}
  .cap{position:absolute;left:8px;top:6px;color:#fff;opacity:.7;z-index:2}
  canvas{display:block}
</style></head><body><div class=grid id=g></div>
<script>
const CW=${CW},CH=${CH}
// ── ported from lib/compositor/warp.ts ──
function squareToQuad(q){const[p0,p1,p2,p3]=q;const dx1=p1.x-p2.x,dx2=p3.x-p2.x,sx=p0.x-p1.x+p2.x-p3.x;const dy1=p1.y-p2.y,dy2=p3.y-p2.y,sy=p0.y-p1.y+p2.y-p3.y;let a,b,c,d,e,f,g,h;
  if(Math.abs(sx)<1e-9&&Math.abs(sy)<1e-9){a=p1.x-p0.x;b=p3.x-p0.x;c=p0.x;d=p1.y-p0.y;e=p3.y-p0.y;f=p0.y;g=0;h=0}
  else{const dn=dx1*dy2-dx2*dy1||1e-12;g=(sx*dy2-dx2*sy)/dn;h=(dx1*sy-sx*dy1)/dn;a=p1.x-p0.x+g*p1.x;b=p3.x-p0.x+h*p3.x;c=p0.x;d=p1.y-p0.y+g*p1.y;e=p3.y-p0.y+h*p3.y;f=p0.y}
  return[a,b,c,d,e,f,g,h,1]}
function applyH(m,u,v){const x=m[0]*u+m[1]*v+m[2],y=m[3]*u+m[4]*v+m[5],w=m[6]*u+m[7]*v+m[8];const iw=Math.abs(w)<1e-12?0:1/w;return{x:x*iw,y:y*iw}}
function drawTri(ctx,src,x0,y0,x1,y1,x2,y2,u0,v0,u1,v1,u2,v2){const gx=(x0+x1+x2)/3,gy=(y0+y1+y2)/3,ph=(x,y)=>{const dx=x-gx,dy=y-gy,d=Math.hypot(dx,dy)||1;return[x+dx/d*0.6,y+dy/d*0.6]};const[cx0,cy0]=ph(x0,y0),[cx1,cy1]=ph(x1,y1),[cx2,cy2]=ph(x2,y2);ctx.save();ctx.beginPath();ctx.moveTo(cx0,cy0);ctx.lineTo(cx1,cy1);ctx.lineTo(cx2,cy2);ctx.closePath();ctx.clip();u1-=u0;u2-=u0;v1-=v0;v2-=v0;x1-=x0;x2-=x0;y1-=y0;y2-=y0;const det=u1*v2-u2*v1;if(det){const a=(v2*x1-v1*x2)/det,b=(v2*y1-v1*y2)/det,c=(u1*x2-u2*x1)/det,d=(u1*y2-u2*y1)/det;ctx.transform(a,b,c,d,x0-a*u0-c*v0,y0-b*u0-d*v0);ctx.drawImage(src,0,0)}ctx.restore()}
function drawQuadWarp(ctx,src,quad,N=16){const sw=src.width,sh=src.height;const m=squareToQuad(quad);const dst=[];for(let j=0;j<=N;j++){const r=[];for(let i=0;i<=N;i++)r.push(applyH(m,i/N,j/N));dst.push(r)}
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const su0=i/N*sw,sv0=j/N*sh,su1=(i+1)/N*sw,sv1=(j+1)/N*sh;const a=dst[j][i],b=dst[j][i+1],c=dst[j+1][i+1],d=dst[j+1][i];drawTri(ctx,src,a.x,a.y,b.x,b.y,c.x,c.y,su0,sv0,su1,sv0,su1,sv1);drawTri(ctx,src,a.x,a.y,c.x,c.y,d.x,d.y,su0,sv0,su1,sv1,su0,sv1)}}

// content tile: pink/orange checker + bold "Aa"
function contentTile(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
  const n=6,cw=w/n,ch=h/n;for(let j=0;j<n;j++)for(let i=0;i<n;i++){x.fillStyle=(i+j)%2?'#ff2d6b':'#ffb43e';x.fillRect(i*cw,j*ch,cw+1,ch+1)}
  x.fillStyle='#0a0a0a';x.font='900 '+Math.round(h*0.5)+'px Arial';x.textAlign='center';x.textBaseline='middle';x.fillText('Aa',w/2,h/2);return c}

function cell(title,draw){const d=document.createElement('div');d.className='cell';const cv=document.createElement('canvas');cv.width=CW;cv.height=CH;d.appendChild(cv);const cap=document.createElement('div');cap.className='cap';cap.textContent=title;d.appendChild(cap);draw(cv.getContext('2d'));return d}
const g=document.getElementById('g')
const BW=180,BH=140  // content box
const tile=contentTile(BW,BH)
const cx=CW/2,cy=CH/2,hw=BW/2,hh=BH/2

g.appendChild(cell('Original',ctx=>{ctx.translate(cx,cy);ctx.drawImage(tile,-hw,-hh)}))
g.appendChild(cell('Slant X 25°',ctx=>{ctx.translate(cx,cy);ctx.transform(1,0,Math.tan(25*Math.PI/180),1,0,0);ctx.drawImage(tile,-hw,-hh)}))
g.appendChild(cell('Perspective (trapezoid)',ctx=>{ctx.translate(cx,cy);const p=0.4;const quad=[{x:-hw+p*hw,y:-hh},{x:hw-p*hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}];drawQuadWarp(ctx,tile,quad,16)}))
g.appendChild(cell('Corner-pin (arbitrary)',ctx=>{ctx.translate(cx,cy);const quad=[{x:-hw-10,y:-hh+30},{x:hw,y:-hh-20},{x:hw-20,y:hh},{x:-hw+25,y:hh+15}];drawQuadWarp(ctx,tile,quad,16)}))
</script></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: CW * 4 + 8, height: CH + 8 } })
await page.setContent(html)
await page.waitForTimeout(250)
const out = new URL('./warp-verify.png', import.meta.url).pathname
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log('wrote', out)
