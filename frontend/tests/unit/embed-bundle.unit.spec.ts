import { describe, it, expect } from 'vitest'
import { buildEmbedHtml, externalRefs } from '~/lib/embed/bundle'
import { t01At } from '~/lib/embed/clock'
import type { EmbedSnapshot } from '~/lib/embed/contract'

const POSTER = 'data:image/png;base64,iVBORw0KGgo='

// A realistic poster: real bytes through a real base64 encoder, long enough
// that "//" is all but guaranteed to appear (and reproducibly does, with this
// seed). This is the regression test for EXTERNAL_REF_PATTERN's "(https?:)?"
// bug — that pattern treats a bare "//" as an external reference, so it fails
// on every genuine export, not just this one.
function realisticPosterDataUrl(): string {
  const bytes = new Uint8Array(4096)
  let seed = 1337
  for (let i = 0; i < bytes.length; i++) {
    // Deterministic LCG — no crypto needed, just needs to not be all-zero.
    seed = (seed * 1103515245 + 12345) % 2147483648
    bytes[i] = (seed >>> 16) & 0xff
  }
  // Real raster data routinely has runs of identical bytes (an opaque alpha
  // channel, a solid fill) — force one so the base64 payload is guaranteed to
  // contain "//" rather than relying on the LCG's statistical luck. Three
  // 0xff bytes base64-encode to exactly "////".
  bytes.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 512)
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  const base64 = Buffer.from(binary, 'binary').toString('base64')
  return `data:image/png;base64,${base64}`
}

function snap(over: Partial<EmbedSnapshot> = {}): EmbedSnapshot {
  return {
    kind: 'shader',
    config: { effects: [{ effectId: 'aurora', source: '// glsl', params: { u_amount: 0.5 }, seed: 42, passes: 1 }] },
    duration: 30,
    width: 800,
    height: 450,
    posterDataUrl: POSTER,
    transparent: false,
    ...over,
  }
}

describe('buildEmbedHtml', () => {
  it('inlines the adapter javascript', () => {
    const html = buildEmbedHtml(snap(), 'globalThis.__SAILOR_SURFACE__ = {};')
    expect(html).toContain('globalThis.__SAILOR_SURFACE__')
  })

  it('inlines the config and the poster', () => {
    const html = buildEmbedHtml(snap(), '')
    expect(html).toContain('aurora')
    expect(html).toContain(POSTER)
  })

  // The poster must render with NO JavaScript at all — a sandboxed preview
  // pane, an email client, a strict CSP host, or an <iframe sandbox> without
  // allow-scripts all block inline <script>. A src assigned by an inline
  // script leaves those viewers with a completely blank page instead of the
  // documented fallback. The data: URI must be in the markup itself.
  it('puts the poster data URI directly in the <img src> attribute, not behind a script', () => {
    const html = buildEmbedHtml(snap(), '')
    const match = html.match(/<img[^>]*id="sailor-poster"[^>]*>/)
    expect(match).not.toBeNull()
    const imgTag = match![0]
    expect(imgTag).toContain(`src="${POSTER}"`)
    // And no script should still be assigning it as a fallback/duplicate path.
    expect(html).not.toContain('__SAILOR_POSTER__')
  })

  // Duplicating the poster (once in the <img src>, once in a JS payload)
  // would inflate every export by the full base64 blob size for no reason.
  it('the poster payload appears exactly once in the document', () => {
    const html = buildEmbedHtml(snap(), '')
    const occurrences = html.split(POSTER).length - 1
    expect(occurrences).toBe(1)
  })

  it('contains no external references', () => {
    const html = buildEmbedHtml(snap(), 'const x = 1;')
    expect(externalRefs(html)).toEqual([])
  })

  it('escapes a closing script tag hidden in the config', () => {
    const html = buildEmbedHtml(
      snap({ config: { effects: [{ effectId: '</script><img src=x>', source: '', params: {}, seed: 1, passes: 1 }] } }),
      '',
    )
    expect(html).not.toContain('</script><img')
  })

  it('rejects a non-positive duration', () => {
    expect(() => buildEmbedHtml(snap({ duration: 0 }), '')).toThrow(/duration/i)
  })

  it('rejects a poster that is not a data URI', () => {
    expect(() => buildEmbedHtml(snap({ posterDataUrl: 'https://example.com/p.png' }), '')).toThrow(/data:/i)
  })

  it('rejects an adapter bundle containing a literal "</script" sequence', () => {
    expect(() => buildEmbedHtml(snap(), 'var s = "</script>";')).toThrow(/script/i)
  })

  it('rejects an adapter bundle containing "</SCRIPT" case-insensitively', () => {
    expect(() => buildEmbedHtml(snap(), 'var s = "</SCRIPT>";')).toThrow(/script/i)
  })
})

describe('externalRefs', () => {
  it('is clean for a realistic base64 poster containing "//"', () => {
    const poster = realisticPosterDataUrl()
    expect(poster).toContain('//') // the fixture must actually exercise the bug
    const html = buildEmbedHtml(snap({ posterDataUrl: poster }), 'const x = 1;')
    expect(externalRefs(html)).toEqual([])
  })

  it('ignores a sourcemap comment in the adapter bundle', () => {
    const html = buildEmbedHtml(snap(), 'const x = 1;\n//# sourceMappingURL=index.js.map')
    expect(externalRefs(html)).toEqual([])
  })

  it('detects a root-relative fetch() in the adapter bundle', () => {
    const html = buildEmbedHtml(snap(), 'fetch("/api/thing").then(function(){});')
    expect(externalRefs(html)).not.toEqual([])
  })

  it('detects an absolute https URL in the adapter bundle', () => {
    const html = buildEmbedHtml(snap(), 'var u = "https://evil.example.com/x.js";')
    expect(externalRefs(html)).not.toEqual([])
  })

  it('detects a protocol-relative CSS url()', () => {
    const html = buildEmbedHtml(snap(), 'var css = "body{background:url(//cdn.example.com/a.png)}";')
    expect(externalRefs(html)).not.toEqual([])
  })

  it('detects a root-relative CSS url()', () => {
    const html = buildEmbedHtml(snap(), 'var css = "body{background:url(/images/a.png)}";')
    expect(externalRefs(html)).not.toEqual([])
  })

  // Regression test for the data: scrub being unbounded. `[^"')\s]*` has no
  // idea where the base64 payload ends, so it consumed straight through the
  // "=" padding and into whatever followed — hiding a real external URL from
  // the scan entirely. Bounding the scrub to the base64 alphabet (which
  // cannot contain ":") fixes this: verify against the unbounded pattern by
  // temporarily restoring it and confirming this test fails.
  it('detects a URL smuggled directly after a base64 payload in config', () => {
    const html = buildEmbedHtml(
      snap({
        config: {
          effects: [
            {
              effectId: 'data:image/png;base64,AAAA=https://evil.example.com/x',
              source: '',
              params: {},
              seed: 1,
              passes: 1,
            },
          ],
        },
      }),
      '',
    )
    expect(externalRefs(html)).toEqual(
      expect.arrayContaining([expect.stringContaining('https://evil.example.com/x')]),
    )
  })

  // Regression test for the data: scrub trusting the base64 alphabet to
  // self-delimit. The alphabet contains h, t, t, p, s, so a payload glued
  // directly to a URL with NO delimiter at all (no "=" padding, no quote) had
  // its scheme letters eaten by the greedy match, leaving a schemeless
  // "://evil.example.com/..." that no scan pattern recognizes. Anchoring the
  // scrub to a real terminator (quote/paren/whitespace/end-of-string) leaves
  // this string unscrubbed instead, so the URL survives into the scan intact.
  // Verify against the un-anchored pattern by temporarily restoring it and
  // confirming this test fails.
  it('detects a URL glued directly after a base64 payload with no delimiter at all', () => {
    const html = buildEmbedHtml(
      snap({
        config: {
          effects: [
            {
              effectId: 'data:image/png;base64,AAAAhttps://evil.example.com/nopad',
              source: '',
              params: {},
              seed: 1,
              passes: 1,
            },
          ],
        },
      }),
      '',
    )
    expect(externalRefs(html)).toEqual(
      expect.arrayContaining([expect.stringContaining('https://evil.example.com/nopad')]),
    )
  })
})

describe('generated runtime clock', () => {
  // The runtime script embeds its own copy of t01At as an ES5 template-literal
  // string (it can't import clock.ts into the exported file). Extract it and
  // execute it for real, so a future edit to either copy that makes them
  // diverge gets caught instead of only ever substring-matching the HTML.
  function extractRuntimeT01At(html: string): (ms: number, dur: number) => number {
    const match = html.match(/function t01At\(ms, dur\) \{[\s\S]*?\n {2}\}/)
    if (!match) throw new Error('could not find t01At in generated runtime')
    // eslint-disable-next-line no-new-func
    return new Function(`return (${match[0].replace('function t01At', 'function')});`)()
  }

  it('agrees with clock.ts across a range of inputs, including the wrap boundary and negative elapsed', () => {
    const html = buildEmbedHtml(snap({ duration: 30 }), '')
    const runtimeT01At = extractRuntimeT01At(html)

    const cases: Array<[number, number]> = [
      [0, 30],
      [15_000, 30],
      [30_000, 30], // wrap boundary: t = duration -> 0
      [45_000, 30],
      [-15_000, 30], // negative elapsed
      [-1_000, 30],
      [9_999_999, 30],
      [1234, 0], // non-positive duration
      [1234, -5],
    ]

    for (const [ms, dur] of cases) {
      expect(runtimeT01At(ms, dur)).toBeCloseTo(t01At(ms, dur), 9)
    }
  })
})
