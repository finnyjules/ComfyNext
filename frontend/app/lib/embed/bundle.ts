import type { EmbedSnapshot } from './contract'

/**
 * Scans the HTML this bundler itself generates for references that would make
 * the exported file reach the network. It targets first-party generated
 * output — the config JSON, the inlined poster, and the adapter bundle we
 * control — not arbitrary third-party JS. It does NOT catch `new Worker()`,
 * `EventSource`, `XMLHttpRequest.open`, or schemeless-relative references like
 * `fetch("api/x")`. Returns what it found so a failure can say WHAT matched,
 * not just that something did.
 *
 * Scrubbing first is essential: base64 payloads routinely contain "//", and the
 * minifier emits //# sourceMappingURL comments. Scanning raw HTML for a bare "//"
 * reports both as network references and fails every genuine export.
 */
export function externalRefs(html: string): string[] {
  const scrubbed = html
    // Inlined assets are the mechanism, not a violation. Collapse them first.
    // Bounded to the base64 alphabet (which cannot contain ":") so a URL
    // immediately following a payload's terminal "=" padding is not absorbed
    // into the match and hidden from the scan below.
    //
    // The base64 alphabet also contains h, t, t, p, s — so when a payload is
    // glued directly to a URL with NO delimiter (no "=" padding, no quote),
    // the greedy alphabet class happily eats the scheme letters as if they
    // were payload, leaving a schemeless "://host/x" that none of the scan
    // patterns below recognize (they all require an explicit "http(s):" or
    // an attribute/CSS/JS wrapper). The trailing lookahead anchors the match
    // to a real terminator (a quote, paren, whitespace, or end of string)
    // instead of trusting the alphabet to self-delimit. When no such
    // terminator exists, the whole data: URI is left unscrubbed rather than
    // partially consumed — so the smuggled URL survives intact into the scan
    // and gets caught by the absolute-URL pattern. Do not remove this
    // lookahead to "simplify" the regex: without it this scrub reintroduces
    // a false negative on the export's sole network-reachability gate.
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]*={0,2}(?=["')\s]|$)/gi, 'data:INLINED')
    // Minifier sourcemap comments are not network references.
    .replace(/\/\/[#@]\s*sourceMappingURL=[^\s*]*/g, '')

  const patterns: RegExp[] = [
    /https?:\/\/[^\s"')]+/gi, // absolute URL
    /(?:src|href)\s*=\s*["']\/\/[^"']*/gi, // protocol-relative in an attribute
    /(?:src|href)\s*=\s*["']\/(?!\/)[^"']*/gi, // root-relative in an attribute
    /\burl\(\s*["']?(?:(?:https?:)?\/\/|\/(?!\/))[^)]*/gi, // CSS url(), protocol-relative or root-relative
    /@import\s+["'][^"']*/gi, // CSS @import
    /\bfetch\(\s*["']\/[^"']*/gi, // root-relative fetch from adapter JS
    /\bnew\s+WebSocket\(\s*["'][^"']*/gi, // websocket
  ]

  const found: string[] = []
  for (const re of patterns) {
    for (const m of scrubbed.matchAll(re)) found.push(m[0])
  }
  return found
}

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
  // adapterJs is spliced verbatim into an inline <script> block below (unlike
  // the config JSON, which safeJson escapes). A literal "</script" anywhere in
  // it — in a string constant, a regex, or even a comment — terminates that
  // block early in the HTML parser, silently truncating the page to a
  // poster-only export with no runtime error. Escaping raw JavaScript for a
  // script context is subtle and easy to get wrong, so fail loudly instead:
  // today's bundle doesn't contain this sequence, but nothing guarantees a
  // future adapter build won't.
  if (/<\\?\/script/i.test(adapterJs)) {
    throw new Error(
      `embed: adapter bundle for "${snapshot.kind}" contains a "</script" sequence, which would terminate ` +
        'the inline <script> block early and ship a poster-only export. The adapter bundle must not contain that sequence.',
    )
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
    // elapsed accumulates completed play spans; resumedAt anchors the current one.
    // Phase = elapsed + (now - resumedAt), so pause/resume never rewinds to 0.
    var elapsed = 0, resumedAt = 0, raf = 0, visible = true;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var now2 = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };

    function size() {
      handle.setSize(box.clientWidth || snap.width, box.clientHeight || snap.height);
    }
    size();
    window.addEventListener('resize', size);

    if (reduce) { handle.setTime(0); return; }

    function tick(now) {
      handle.setTime(t01At(elapsed + (now - resumedAt), snap.duration));
      raf = requestAnimationFrame(tick);
    }
    // Guarded by 'raf', which is only ever non-zero between a play() call and its
    // matching pause(). The synchronous 'if (visible) play()' below and the
    // IntersectionObserver's first (always-async) callback therefore cannot
    // both start a loop: whichever runs first sets raf, so the other is a no-op.
    function play() { if (raf) return; resumedAt = now2(); raf = requestAnimationFrame(tick); }
    function pause() { if (!raf) return; cancelAnimationFrame(raf); raf = 0; elapsed += now2() - resumedAt; }

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
