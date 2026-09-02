import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chromiumMajorVersion,
  forceGoogleClientHints,
  googleAuthClientHints,
  googleUserAgentMetadata,
  isGoogleAuthUrl,
  rewriteRequestClientHints,
  stripEmbedderFromUserAgent
} from './browser-auth-client-hints.ts'

test('Google auth matching is exact and version-derived', () => {
  assert.equal(isGoogleAuthUrl('https://accounts.google.com/signin'), true)
  assert.equal(isGoogleAuthUrl('https://www.google.com/search?q=test'), false)
  assert.equal(isGoogleAuthUrl('https://accounts.google.com.attacker.test/'), false)
  assert.equal(chromiumMajorVersion('Chrome/150.0.7871.114 Safari/537.36'), 150)
})

test('CDP UA metadata includes the Google Chrome brand (the whole point of the override)', () => {
  const meta = googleUserAgentMetadata('Chrome/150.0.7871.114 Safari/537.36')
  assert.ok(meta, 'metadata should build from a versioned UA')
  // "Google Chrome" MUST be present — its absence (bare Chromium) is exactly what Google blocks.
  assert.ok(meta!.brands.some((b) => b.brand === 'Google Chrome' && b.version === '150'))
  assert.ok(meta!.fullVersionList.some((b) => b.brand === 'Google Chrome' && b.version === '150.0.7871.114'))
  // GREASE brand present; platform truthful and non-mobile.
  assert.ok(meta!.brands.some((b) => b.brand === 'Not(A:Brand'))
  assert.equal(meta!.mobile, false)
})

test('CDP UA metadata falls back to a synthetic full version when the UA has only a major', () => {
  const meta = googleUserAgentMetadata('Chrome/150 Safari/537.36')
  // chromiumMajorVersion needs "Chrome/150." — a bare major without a dot yields null, so this
  // guards the exact format initCdp synthesizes (`Chrome/<full> `) rather than a bare major.
  assert.equal(meta, null)
  const withDot = googleUserAgentMetadata('Chrome/150.0.0.0 ')
  assert.ok(withDot)
  assert.ok(withDot!.fullVersionList.some((b) => b.version === '150.0.0.0'))
})

test('CDP UA metadata returns null for a UA with no Chrome version (degrade, do not emit garbage)', () => {
  assert.equal(googleUserAgentMetadata('Mozilla/5.0 (X11; Linux x86_64)'), null)
  assert.equal(googleUserAgentMetadata(''), null)
})

test('Google Client Hints omit Electron and preserve header casing', () => {
  const headers: Record<string, string | string[]> = {
    'Sec-CH-UA': '"Chromium";v="150", "Electron";v="43"'
  }
  const hints = googleAuthClientHints(150, '150.0.7871.114')
  assert.equal(rewriteRequestClientHints(headers, hints), true)
  assert.equal(headers['Sec-CH-UA'], hints['sec-ch-ua'])
  assert.ok(!String(headers['Sec-CH-UA']).includes('Electron'))
})

test('Google auth requests receive hints even when Chromium omitted them', () => {
  const headers: Record<string, string | string[]> = {
    'User-Agent': 'Chrome/150.0 Electron/43.1.1 CodeApp/0.1.0'
  }
  const hints = googleAuthClientHints(150, '150.0.7871.114')
  assert.equal(forceGoogleClientHints(headers, hints), true)
  assert.equal(headers['Sec-CH-UA'], hints['sec-ch-ua'])
  assert.equal(headers['Sec-CH-UA-Full-Version-List'], hints['sec-ch-ua-full-version-list'])
})

test('wire identity strips Electron and the app token from request UA', () => {
  const headers: Record<string, string | string[]> = {
    'User-Agent': 'Chrome/150.0 Electron/43.1.1 CodeApp/0.1.0'
  }
  assert.equal(stripEmbedderFromUserAgent(headers, 'CodeApp'), true)
  assert.equal(headers['User-Agent'], 'Chrome/150.0')
})
