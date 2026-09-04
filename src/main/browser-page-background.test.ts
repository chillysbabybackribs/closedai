import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PAGE_BACKGROUND_PROBE,
  PageBackgroundMemory,
  normalizeCssColor,
  pageBackgroundColor,
  pageBackgroundOrigin
} from './browser-page-background.js'

describe('normalizeCssColor', () => {
  it('normalizes the forms getComputedStyle actually returns', () => {
    strictEqual(normalizeCssColor('rgb(16, 16, 20)'), '#101014')
    strictEqual(normalizeCssColor('rgba(255, 255, 255, 1)'), '#ffffff')
    strictEqual(normalizeCssColor('rgb(0 0 0 / 100%)'), '#000000')
    strictEqual(normalizeCssColor('#FFF'), '#ffffff')
    strictEqual(normalizeCssColor('#1c1c1dff'), '#1c1c1d')
  })

  it('treats anything less than opaque as unknown rather than a colour', () => {
    // A translucent canvas composites over the base colour, so it does not say what the
    // base should be; filling a gap with it would be a confident guess at the wrong colour.
    strictEqual(normalizeCssColor('rgba(0, 0, 0, 0)'), null)
    strictEqual(normalizeCssColor('rgba(16, 16, 20, 0.5)'), null)
    strictEqual(normalizeCssColor('rgb(0 0 0 / 40%)'), null)
    strictEqual(normalizeCssColor('#10101480'), null)
  })

  it('rejects values it cannot read', () => {
    strictEqual(normalizeCssColor('transparent'), null)
    strictEqual(normalizeCssColor('color(srgb 1 1 1)'), null)
    strictEqual(normalizeCssColor(''), null)
    strictEqual(normalizeCssColor(undefined), null)
    strictEqual(normalizeCssColor(42), null)
  })

  it('clamps out-of-range channels instead of emitting invalid hex', () => {
    strictEqual(normalizeCssColor('rgb(-10, 300, 20.6)'), '#00ff15')
  })
})

describe('pageBackgroundColor', () => {
  it('prefers the root element, which is what CSS propagates to the canvas', () => {
    strictEqual(pageBackgroundColor({ root: 'rgb(16, 16, 20)', body: 'rgb(255, 255, 255)' }), '#101014')
  })

  it('falls back to the body only when the root paints nothing', () => {
    strictEqual(pageBackgroundColor({ root: 'rgba(0, 0, 0, 0)', body: 'rgb(18, 18, 18)' }), '#121212')
  })

  it('reports a page that paints nothing at all as unknown', () => {
    strictEqual(pageBackgroundColor({ root: 'rgba(0, 0, 0, 0)', body: 'rgba(0, 0, 0, 0)' }), null)
    strictEqual(pageBackgroundColor(null), null)
    strictEqual(pageBackgroundColor('rgb(0,0,0)'), null)
  })

  it('reads the pair the injected probe returns', () => {
    // The probe is a string evaluated in the page; keep its shape and this parser together.
    strictEqual(PAGE_BACKGROUND_PROBE.includes('documentElement'), true)
    strictEqual(PAGE_BACKGROUND_PROBE.includes('document.body'), true)
  })
})

describe('pageBackgroundOrigin', () => {
  it('keys on the origin so every page of a site shares one colour', () => {
    strictEqual(pageBackgroundOrigin('https://www.google.com/search?q=x'), 'https://www.google.com')
    strictEqual(pageBackgroundOrigin('http://127.0.0.1:5180/a'), 'http://127.0.0.1:5180')
  })

  it('refuses URLs a colour cannot meaningfully be keyed to', () => {
    strictEqual(pageBackgroundOrigin('about:blank'), null)
    strictEqual(pageBackgroundOrigin('data:text/html,<body>'), null)
    strictEqual(pageBackgroundOrigin('file:///tmp/page.html'), null)
    strictEqual(pageBackgroundOrigin('not a url'), null)
  })
})

describe('PageBackgroundMemory', () => {
  it('answers for any page of a remembered site', () => {
    const memory = new PageBackgroundMemory()
    memory.remember('https://example.com/one', '#101014')
    strictEqual(memory.recall('https://example.com/two?q=1'), '#101014')
    strictEqual(memory.recall('https://other.com/'), null)
  })

  it('keeps only the newest colour for a site', () => {
    const memory = new PageBackgroundMemory()
    memory.remember('https://example.com/', '#ffffff')
    memory.remember('https://example.com/dark', '#101014')
    strictEqual(memory.recall('https://example.com/'), '#101014')
    strictEqual(memory.size, 1)
  })

  it('ignores URLs with no origin to key on', () => {
    const memory = new PageBackgroundMemory()
    memory.remember('about:blank', '#101014')
    strictEqual(memory.size, 0)
    strictEqual(memory.recall('about:blank'), null)
  })

  it('bounds itself, evicting the least recently used site', () => {
    const memory = new PageBackgroundMemory()
    for (let index = 0; index < 320; index += 1) memory.remember(`https://site${index}.test/`, '#101014')
    strictEqual(memory.size, 300)
    strictEqual(memory.recall('https://site0.test/'), null)
    strictEqual(memory.recall('https://site319.test/'), '#101014')
  })

  it('counts a recall as use, so an actively visited site is not evicted', () => {
    const memory = new PageBackgroundMemory()
    for (let index = 0; index < 300; index += 1) memory.remember(`https://site${index}.test/`, '#101014')
    strictEqual(memory.recall('https://site0.test/'), '#101014')
    memory.remember('https://newcomer.test/', '#ffffff')
    strictEqual(memory.recall('https://site0.test/'), '#101014')
    strictEqual(memory.recall('https://site1.test/'), null)
  })
})

describe('probe result shape', () => {
  it('survives a page that answers with junk', () => {
    deepStrictEqual([
      pageBackgroundColor({ root: 5, body: {} }),
      pageBackgroundColor({}),
      pageBackgroundColor([])
    ], [null, null, null])
  })
})
