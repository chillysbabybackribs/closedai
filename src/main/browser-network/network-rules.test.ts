import assert from 'node:assert/strict'
import test from 'node:test'
import { globToRegExp, NetworkRules } from './network-rules.js'

test('globs match the whole URL and plain patterns match as substrings', () => {
  assert.equal(globToRegExp('https://*.tracker.test/*')?.test('https://cdn.tracker.test/px.gif'), true)
  assert.equal(globToRegExp('https://*.tracker.test/*')?.test('https://tracker.test/px.gif'), false)
  assert.equal(globToRegExp('/api/'), null)
  const rules = new NetworkRules()
  rules.add({ action: 'block', urlPattern: 'tracker.test' })
  assert.equal(rules.decide('https://x.tracker.test/a', 'tab-1')?.ruleId, 'rule-1')
  assert.equal(rules.decide('https://safe.test/a', 'tab-1'), null)
})

test('block beats redirect, tab scope is honoured, and hits count', () => {
  const rules = new NetworkRules()
  const redirect = rules.add({ action: 'redirect', urlPattern: 'https://a.test/*', redirectUrl: 'https://b.test/', tabId: 'tab-1' })
  const block = rules.add({ action: 'block', urlPattern: 'https://a.test/secret*' })
  assert.deepEqual(rules.decide('https://a.test/secret/1', 'tab-1'), { cancel: true, ruleId: block.id })
  assert.deepEqual(rules.decide('https://a.test/page', 'tab-1'), { redirectUrl: 'https://b.test/', ruleId: redirect.id })
  assert.equal(rules.decide('https://a.test/page', 'tab-2'), null)
  assert.equal(rules.decide('https://a.test/page', null), null)
  assert.deepEqual(rules.list().map((rule) => [rule.id, rule.hits]), [[redirect.id, 1], [block.id, 1]])
})

test('header rules set, replace regardless of casing, and remove with null', () => {
  const rules = new NetworkRules()
  rules.add({ action: 'request_headers', urlPattern: 'api.test', headers: { Authorization: 'Bearer t', 'X-Debug': null } })
  const headers: Record<string, string | string[]> = { 'x-debug': '1', accept: '*/*' }
  rules.applyRequestHeaders('https://api.test/v1', 'tab-1', headers)
  assert.deepEqual(headers, { accept: '*/*', authorization: 'Bearer t' })
  rules.add({ action: 'response_headers', urlPattern: 'api.test', headers: { 'Content-Security-Policy': null } })
  const response: Record<string, string | string[]> = { 'Content-Security-Policy': ["default-src 'self'"], server: 'x' }
  rules.applyResponseHeaders('https://api.test/v1', 'tab-1', response)
  assert.deepEqual(response, { server: 'x' })
})

test('validates rule inputs and removes by id', () => {
  const rules = new NetworkRules()
  assert.throws(() => rules.add({ action: 'redirect', urlPattern: 'a' }), /redirect_url/)
  assert.throws(() => rules.add({ action: 'request_headers', urlPattern: 'a', headers: {} }), /headers/)
  assert.throws(() => rules.add({ action: 'block', urlPattern: '  ' }), /url_pattern/)
  const rule = rules.add({ action: 'block', urlPattern: 'a', note: 'test' })
  assert.equal(rules.remove(rule.id), true)
  assert.equal(rules.remove(rule.id), false)
  assert.deepEqual(rules.list(), [])
})
