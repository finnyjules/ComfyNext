import type { EmbedSnapshot } from './contract'

/**
 * Any reference that would make the file reach the network. Asserted against
 * every built embed — self-containment is a guarantee, not an intention.
 * `data:` URIs are explicitly fine and must not match.
 */
export const EXTERNAL_REF_PATTERN = /(https?:)?\/\/[^\s"')]+|(?:src|href)\s*=\s*["']\/(?!\/)/gi

/** Neutralize sequences that would break out of the inline <script> block. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function buildEmbedHtml(snapshot: EmbedSnapshot, adapterJs: string): string {
  if (!(snapshot.duration > 0)) {
    throw new Error(`embed: duration must be positive, got ${snapshot.duration}`)
  }
  if (!snapshot.posterDataUrl.startsWith('data:')) {
    throw new Error('embed: poster must be a data: URI — an external poster would break self-containment')
  }

  const bg = snapshot.transparent ? 'transparent' : '#000'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sailor embed</title>
<style>
  html,body{margin:0;padding:0;background:${bg};overflow:hidden}
  #sailor-embed{position:relative;width:100vw;height:100vh}
  #sailor-embed canvas{display:block;width:100%;height:100%}
  #sailor-poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  #sailor-poster[hidden]{display:none}
</style>
</head>
<body>
<div id="sailor-embed"><img id="sailor-poster" alt=""></div>
<script>
window.__SAILOR_SNAPSHOT__ = ${safeJson({ ...snapshot, posterDataUrl: '' })};
window.__SAILOR_POSTER__ = ${safeJson(snapshot.posterDataUrl)};
document.getElementById('sailor-poster').src = window.__SAILOR_POSTER__;
</script>
<script>
${adapterJs}
</script>
<script>
(function () {
  var box = document.getElementById('sailor-embed');
  var poster = document.getElementById('sailor-poster');
  var snap = window.__SAILOR_SNAPSHOT__;
  var surface = window.__SAILOR_SURFACE__;

  function t01At(ms, dur) {
    if (!(dur > 0)) return 0;
    var d = dur * 1000, w = ms % d;
    return (w < 0 ? w + d : w) / d;
  }

  // Poster stays visible until the live renderer has actually produced a frame.
  // If anything below throws, it simply never hides — a still frame, never a
  // blank rectangle and never an error in someone else's console.
  if (!surface || typeof surface.mount !== 'function') return;

  surface.mount(box, snap.config).then(function (handle) {
    poster.hidden = true;
    var t0 = null, raf = 0, visible = true;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function size() {
      handle.setSize(box.clientWidth || snap.width, box.clientHeight || snap.height);
    }
    size();
    window.addEventListener('resize', size);

    if (reduce) { handle.setTime(0); return; }

    function tick(now) {
      if (t0 === null) t0 = now;
      handle.setTime(t01At(now - t0, snap.duration));
      raf = requestAnimationFrame(tick);
    }
    function play() { if (!raf) raf = requestAnimationFrame(tick); }
    function pause() { if (raf) { cancelAnimationFrame(raf); raf = 0; } t0 = null; }

    // Ten embeds on one page should not cook a laptop.
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        visible ? play() : pause();
      }).observe(box);
    } else { play(); }
    if (visible) play();
  }).catch(function () { /* poster remains visible */ });
})();
</script>
</body>
</html>
`
}
