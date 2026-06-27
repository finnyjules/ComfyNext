// Visual verification for the Frame-modal fill types. Renders every Type-Studio
// fill (solid/gradient/ombre/grid/noise/checkerboard/stripes/qr) on a rect, an
// ellipse and text, using the SAME fillTileCanvas logic + the resolveFill
// span-to-box pattern transform the compositor uses. Screenshots via Playwright.
// Run: node tests/manual/fills-screenshot.mjs
import { chromium } from '@playwright/test'

const TYPES = ['solid', 'gradient', 'ombre', 'grid', 'noise', 'checkerboard', 'stripes', 'qr']
const A = '#ff2d6b', B = '#ffb43e'
const fills = TYPES.map(type => ({ type, a: A, b: B, textColor: A, angle: 45, density: 6 }))

const CW = 210, CH = 150

// The page redraws each fill on three shapes. The builder block below is a 1:1
// port of frontend/app/lib/spacetype/fillTile.ts (verified by the unit tests) plus
// the resolveFill() pattern transform from useCompositorLayers.ts.
const html = `<!doctype html><html><head><meta charset=utf8><style>
  body{margin:0;background:#0a0a0a;font:11px -apple-system,sans-serif;color:#888}
  .grid{display:grid;grid-template-columns:80px repeat(3,${CW}px);gap:1px;background:#1c1c1c}
  .h{display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fff;padding:4px}
  .cell{position:relative;width:${CW}px;height:${CH}px;background:#161616}
  .rl{position:absolute;left:6px;top:5px;color:#fff;opacity:.55;text-transform:capitalize;z-index:2}
  canvas{display:block}
</style></head><body><div class=grid id=g></div>
<script>
const CW=${CW},CH=${CH}
const fills=${JSON.stringify(fills)}
function hexBytes(hex){const h=hex.replace('#','');const s=h.length===3?h.split('').map(c=>c+c).join(''):h;const n=parseInt(s,16);return [(n>>16)&255,(n>>8)&255,n&255]}
function ombrePicker(w,h,angle){const rad=angle*Math.PI/180,dx=Math.cos(rad),dy=Math.sin(rad);const cor=[0,w*dx,h*dy,w*dx+h*dy];const pmin=Math.min(...cor),range=(Math.max(...cor)-pmin)||1;return (px,py)=>{const t=(px*dx+py*dy-pmin)/range;const hsh=Math.sin(px*12.9898+py*78.233)*43758.5453;return (hsh-Math.floor(hsh))<t}}
function patternImageData(w,h,colA,colB,picker){const img=new ImageData(w,h);for(let i=0;i<img.data.length;i+=4){const px=(i/4)%w,py=Math.floor((i/4)/w);const useB=picker(px,py);img.data[i]=useB?colB[0]:colA[0];img.data[i+1]=useB?colB[1]:colA[1];img.data[i+2]=useB?colB[2]:colA[2];img.data[i+3]=255}return img}
function fillTileBox(fill,w,h){const W=Math.max(1,Math.round(w)),H=Math.max(1,Math.round(h));const c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d');
  if(fill.type==='solid'){ctx.fillStyle=fill.a;ctx.fillRect(0,0,W,H);return c}
  if(fill.type==='gradient'){const rad=fill.angle*Math.PI/180,hx=Math.cos(rad)*W/2,hy=Math.sin(rad)*H/2;const g=ctx.createLinearGradient(W/2-hx,H/2-hy,W/2+hx,H/2+hy);g.addColorStop(0,fill.a);g.addColorStop(1,fill.b);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);return c}
  if(fill.type==='ombre'){ctx.putImageData(patternImageData(W,H,hexBytes(fill.a),hexBytes(fill.b),ombrePicker(W,H,fill.angle)),0,0);return c}
  const d=Math.max(1,Math.round(fill.density)),cell=Math.max(2,Math.round(W/d));
  if(fill.type==='grid'){ctx.fillStyle=fill.a;ctx.fillRect(0,0,W,H);ctx.strokeStyle=fill.b;ctx.lineWidth=Math.max(1,Math.round(cell*0.08));for(let x=0;x<=W+cell;x+=cell){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}for(let y=0;y<=H+cell;y+=cell){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}return c}
  const colA=hexBytes(fill.a),colB=hexBytes(fill.b);
  const picker=fill.type==='checkerboard'?(px,py)=>(Math.floor(px/cell)+Math.floor(py/cell))%2===1
    :fill.type==='stripes'?(()=>{const rad=fill.angle*Math.PI/180,dx=Math.cos(rad),dy=Math.sin(rad);return (px,py)=>Math.floor((px*dx+py*dy)/cell)%2!==0})()
    :fill.type==='noise'?(px,py)=>{const v=Math.sin(px*12.9898+py*78.233)*43758.5453;return (v-Math.floor(v))>=0.5}
    :(px,py)=>{const cx=Math.floor(px/cell),cy=Math.floor(py/cell);const v=Math.sin(cx*12.9898+cy*78.233+cx*cy*3.71)*43758.5453;return (v-Math.floor(v))>0.45};
  ctx.putImageData(patternImageData(W,H,colA,colB,picker),0,0);return c}
function resolveFill(ctx,fill,box){if(fill.type==='solid')return fill.a;const bw=Math.max(box.w,1e-3),bh=Math.max(box.h,1e-3);const m=ctx.getTransform();const sx=Math.hypot(m.a,m.b)||1,sy=Math.hypot(m.c,m.d)||1;const k=Math.min(1,1024/Math.max(bw*sx,bh*sy,1));const tw=Math.max(1,Math.round(bw*sx*k)),th=Math.max(1,Math.round(bh*sy*k));const tile=fillTileBox(fill,tw,th);const pat=ctx.createPattern(tile,'no-repeat');pat.setTransform(new DOMMatrix().translateSelf(-bw/2,-bh/2).scaleSelf(bw/tw,bh/th));return pat}
function cell(fill,kind){const d=document.createElement('div');d.className='cell';const cv=document.createElement('canvas');cv.width=CW;cv.height=CH;d.appendChild(cv);const ctx=cv.getContext('2d');ctx.translate(CW/2,CH/2);
  if(kind==='rect'){const w=160,h=100;ctx.fillStyle=resolveFill(ctx,fill,{w,h});ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,10);ctx.fill()}
  else if(kind==='ellipse'){const w=150,h=100;ctx.fillStyle=resolveFill(ctx,fill,{w,h});ctx.beginPath();ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);ctx.fill()}
  else{ctx.font='900 64px Arial';ctx.textAlign='center';ctx.textBaseline='middle';const box={w:ctx.measureText('Aa').width,h:64};ctx.fillStyle=resolveFill(ctx,fill,box);ctx.fillText('Aa',0,4)}
  return d}
const g=document.getElementById('g')
const head=['Fill','Rect','Ellipse','Text'];for(const t of head){const h=document.createElement('div');h.className='h';h.textContent=t;g.appendChild(h)}
for(const f of fills){const rl=document.createElement('div');rl.className='h';rl.style.textTransform='capitalize';rl.textContent=f.type;g.appendChild(rl);
  for(const k of ['rect','ellipse','text'])g.appendChild(cell(f,k))}
</script></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 80 + CW * 3 + 8, height: (TYPES.length + 1) * (CH + 1) + 8 } })
await page.setContent(html)
await page.waitForTimeout(250)
const out = new URL('./fills-verify.png', import.meta.url).pathname
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log('wrote', out)
