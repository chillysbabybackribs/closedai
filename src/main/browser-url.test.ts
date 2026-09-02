import assert from 'node:assert/strict'
import test from 'node:test'
import { SEARCH_URL, normalizeUrl, isAbortedNavigation, sameDocumentUrl } from './browser-url.ts'

test('resolves relative browser links against the current page', () => {
  const base = 'https://example.com/account/settings?tab=profile'
  assert.equal(normalizeUrl('/dashboard', base), 'https://example.com/dashboard')
  assert.equal(normalizeUrl('../billing', base), 'https://example.com/billing')
  assert.equal(normalizeUrl('#security', base), 'https://example.com/account/settings?tab=profile#security')
})

test('keeps exact URLs and search fallback behavior', () => {
  assert.equal(normalizeUrl('https://example.com/deep/link'), 'https://example.com/deep/link')
  assert.equal(normalizeUrl('example.com/deep/link'), 'https://example.com/deep/link')
  assert.equal(normalizeUrl('latest browser news'), `${SEARCH_URL}?q=latest%20browser%20news`)
})

test('sameDocumentUrl: reload-free equality is generous on fragments, strict on paths and queries', () => {
  // Same document — a reload would only destroy scroll/input.
  assert.ok(sameDocumentUrl('https://s1.dev', 'https://s1.dev/'))
  assert.ok(sameDocumentUrl('https://s1.dev/pricing', 'https://s1.dev/pricing#tiers'))
  assert.ok(sameDocumentUrl('https://S1.DEV/', 'https://s1.dev'))
  // Different documents — must stay navigable.
  assert.ok(!sameDocumentUrl('https://s1.dev/', 'https://s1.dev/pricing'))
  assert.ok(!sameDocumentUrl('https://s1.dev/a?x=1', 'https://s1.dev/a?x=2'))
  assert.ok(!sameDocumentUrl('https://s1.dev/', 'http://s1.dev/'))
  assert.ok(!sameDocumentUrl('https://s1.dev/docs/', 'https://s1.dev/docs')) // server-meaningful
  assert.ok(!sameDocumentUrl('not a url', 'https://s1.dev/'))
})

test('recognizes an aborted navigation by name, code, or bare (-3) errno', () => {
  // Named form.
  assert.equal(isAbortedNavigation(new Error("ERR_ABORTED (-3) loading 'https://x'")), true)
  // Code-only form.
  const coded = Object.assign(new Error('boom'), { code: 'ERR_ABORTED' })
  assert.equal(isAbortedNavigation(coded), true)
  // Empty-description form actually observed live: just " (-3) loading '<url>'".
  assert.equal(isAbortedNavigation(new Error(" (-3) loading 'https://www.google.com/'")), true)
  // A genuine failure whose URL merely contains "(-3)" must NOT be treated as an abort.
  assert.equal(isAbortedNavigation(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://ex(-3)ample.com'")), false)
  assert.equal(isAbortedNavigation(new Error('some unrelated error')), false)
})
