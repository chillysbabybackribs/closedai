import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BrowserError,
  classifyBrowserError,
  isRendererGoneReason,
  toBrowserErrorPayload
} from './browser-error.ts'

test('an already-classified BrowserError passes through unchanged', () => {
  const original = new BrowserError('js-exception', 'boom', 'stack')
  const classified = classifyBrowserError(original, 'internal')
  assert.equal(classified, original)
  assert.equal(classified.category, 'js-exception')
  assert.equal(classified.detail, 'stack')
})

test('destroyed-target phrasings classify as target-closed', () => {
  for (const message of [
    'Object has been destroyed',
    'WebContents was destroyed',
    'Target closed',
    'Session with given id not found',
    'No active browser tab'
  ]) {
    assert.equal(classifyBrowserError(new Error(message)).category, 'target-closed', message)
  }
})

test('crash and detach phrasings classify distinctly', () => {
  assert.equal(classifyBrowserError(new Error('renderer process gone')).category, 'target-crashed')
  assert.equal(classifyBrowserError(new Error('Page crashed')).category, 'target-crashed')
  assert.equal(classifyBrowserError(new Error('Debugger is not attached to the target')).category, 'cdp-detached')
})

test('ERR_ABORTED is cancelled, other ERR_ codes are navigation-failed', () => {
  assert.equal(classifyBrowserError(new Error("ERR_ABORTED (-3) loading 'https://x'")).category, 'cancelled')
  assert.equal(classifyBrowserError(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://x'")).category, 'navigation-failed')
  assert.equal(classifyBrowserError(new Error("ERR_CERT_DATE_INVALID (-201) loading 'https://x'")).category, 'navigation-failed')
})

test('timeout phrasings classify as timeout and are retryable', () => {
  const error = classifyBrowserError(new Error('Tool timed out after 180000ms'))
  assert.equal(error.category, 'timeout')
  assert.equal(error.retryable, true)
})

test('unattributed errors use the provided fallback, not internal', () => {
  assert.equal(classifyBrowserError(new Error('something odd'), 'js-exception').category, 'js-exception')
  assert.equal(classifyBrowserError(new Error('something odd')).category, 'internal')
})

test('retryable flag is set only for transient categories', () => {
  assert.equal(new BrowserError('target-crashed', 'x').retryable, true)
  assert.equal(new BrowserError('cdp-detached', 'x').retryable, true)
  assert.equal(new BrowserError('timeout', 'x').retryable, true)
  assert.equal(new BrowserError('invalid-input', 'x').retryable, false)
  assert.equal(new BrowserError('target-closed', 'x').retryable, false)
  assert.equal(new BrowserError('js-exception', 'x').retryable, false)
})

test('toPayload / toBrowserErrorPayload produce the stable model envelope', () => {
  const payload = toBrowserErrorPayload(new BrowserError('js-exception', 'boom'))
  assert.deepEqual(payload, { ok: false, category: 'js-exception', message: 'boom', retryable: false })
  const withDetail = new BrowserError('network-body-unavailable', 'gone', 'evicted after navigation').toPayload()
  assert.equal(withDetail.detail, 'evicted after navigation')
})

test('isRendererGoneReason matches crash-class reasons only', () => {
  for (const reason of ['crashed', 'oom', 'killed', 'abnormal-exit', 'launch-failed', 'integrity-failure', 'memory-eviction']) {
    assert.equal(isRendererGoneReason(reason), true, reason)
  }
  assert.equal(isRendererGoneReason('clean-exit'), false)
})

test('non-Error values are classified by their string form', () => {
  assert.equal(classifyBrowserError('Target closed').category, 'target-closed')
  assert.equal(classifyBrowserError({ weird: true }).category, 'internal')
})

// The distinction the category set was missing: a malformed argument and a well-formed
// argument that matched nothing need different responses, so they need different codes.
test('no-match is a distinct, non-retryable category separate from invalid-input', () => {
  const noMatch = new BrowserError('no-match', 'No element matches selector "#gone".')
  assert.equal(noMatch.category, 'no-match')
  // Retrying the identical target cannot succeed — the caller must re-target, which is a
  // decision, not an automatic retry.
  assert.equal(noMatch.retryable, false)
  assert.notEqual(noMatch.category, new BrowserError('invalid-input', 'x').category)
})
