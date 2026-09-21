import assert from 'node:assert/strict'
import test from 'node:test'
import { describeReadiness, readPageText, waitForPageReady, type ScriptRunner } from './browser-page-ready.js'

type Frame = { readyState: string; text: string; selectorHit?: boolean } | 'navigating'

/** A fake page that advances one frame per probe, with a manual clock. */
function fakePage(frames: Frame[]) {
  let clock = 0
  let index = 0
  const contents: ScriptRunner = {
    isDestroyed: () => false,
    async executeJavaScript() {
      const frame = frames[Math.min(index, frames.length - 1)]
      index += 1
      if (frame === 'navigating') throw new Error('Script failed to execute')
      return {
        readyState: frame.readyState,
        textLength: frame.text.length,
        url: 'https://a.test/',
        title: 'A',
        selector: frame.selectorHit ?? null,
        text: null
      }
    }
  }
  const now = () => clock
  const sleep = async (ms: number) => { clock += ms }
  return { contents, now, sleep }
}

test('waitForPageReady resolves at dom-ready for until=dom_ready', async () => {
  const { contents, now, sleep } = fakePage([{ readyState: 'loading', text: '' }, { readyState: 'interactive', text: 'hi' }])
  const result = await waitForPageReady(contents, { until: 'dom_ready', timeoutMs: 5_000 }, now, sleep)
  assert.equal(result.reached, true)
  assert.equal(result.readyState, 'interactive')
  assert.equal(result.conditionMet, null)
})

test('waitForPageReady waits for text to stop changing for until=idle', async () => {
  const { contents, now, sleep } = fakePage([
    { readyState: 'complete', text: 'a' },
    { readyState: 'complete', text: 'ab' },
    { readyState: 'complete', text: 'abc' },
    { readyState: 'complete', text: 'abc' },
    { readyState: 'complete', text: 'abc' },
    { readyState: 'complete', text: 'abc' },
    { readyState: 'complete', text: 'abc' }
  ])
  const result = await waitForPageReady(contents, { until: 'idle', timeoutMs: 5_000 }, now, sleep)
  assert.equal(result.reached, true)
  // Three changes at 0/75/150ms, then stable: idle needs 200ms of no change → ~425ms.
  assert.ok(result.elapsedMs >= 350 && result.elapsedMs < 650, `elapsed ${result.elapsedMs}`)
})

test('waitForPageReady reports a timeout honestly and keeps the last observed state', async () => {
  const { contents, now, sleep } = fakePage([{ readyState: 'interactive', text: 'x' }])
  const result = await waitForPageReady(contents, { until: 'load', timeoutMs: 1_000 }, now, sleep)
  assert.equal(result.reached, false)
  assert.equal(result.readyState, 'interactive')
  assert.ok(result.elapsedMs >= 1_000)
  assert.match(describeReadiness({ until: 'load', timeoutMs: 1_000 }, result), /Not ready: still "dom-ready"/)
})

test('waitForPageReady survives a probe failing mid-navigation and honours a selector condition', async () => {
  const { contents, now, sleep } = fakePage([
    'navigating',
    { readyState: 'complete', text: 'x', selectorHit: false },
    { readyState: 'complete', text: 'x', selectorHit: true }
  ])
  const result = await waitForPageReady(contents, { until: 'load', selector: '#done', timeoutMs: 5_000 }, now, sleep)
  assert.equal(result.reached, true)
  assert.equal(result.conditionMet, true)
  assert.match(describeReadiness({ until: 'load', selector: '#done', timeoutMs: 5_000 }, result), /Selector "#done": found/)
})

test('an unparseable selector stops the wait instead of polling a condition that cannot come true', async () => {
  let probes = 0
  const contents: ScriptRunner = {
    isDestroyed: () => false,
    async executeJavaScript() {
      probes += 1
      return { readyState: 'complete', textLength: 4, url: 'https://a.test/', title: 'A', selectorError: "'div:has-text(\"x\")' is not a valid selector." }
    }
  }
  let clock = 0
  const result = await waitForPageReady(
    contents,
    { until: 'load', selector: 'div:has-text("x")', timeoutMs: 15_000 },
    () => clock,
    async (ms) => { clock += ms }
  )
  assert.equal(probes, 1)
  assert.equal(clock, 0)
  assert.match(result.selectorError ?? '', /not a valid selector/)
  // The page is "complete"; only the selector was bad, so neither claim about it is made.
  const described = describeReadiness({ until: 'load', selector: 'div:has-text("x")', timeoutMs: 15_000 }, result)
  assert.match(described, /rejected "div:has-text\(\\"x\\"\)" as a CSS selector/)
  assert.doesNotMatch(described, /not found|Not ready/)
})

test('readPageText reports a rejected selector, an absent element, and a silent page apart', async () => {
  const page = (result: unknown): ScriptRunner => ({ isDestroyed: () => false, async executeJavaScript() { return result } })
  assert.deepEqual(
    await readPageText(page({ selectorError: 'bad' }), { selector: 'x', maxChars: 100 }),
    { problem: 'selector-invalid', detail: 'bad' }
  )
  assert.deepEqual(
    await readPageText(page({ selectorMissing: true }), { selector: '.itemlist', maxChars: 100 }),
    { problem: 'selector-missing' }
  )
  assert.deepEqual(await readPageText(page(undefined), { maxChars: 100 }), { problem: 'unavailable' })
  // A page that is gone is still the one case the caller must treat as "no tab".
  assert.equal(await readPageText({ isDestroyed: () => true, async executeJavaScript() { return null } }, { maxChars: 100 }), null)
})

test('readPageText tidies whitespace and truncates', async () => {
  const contents: ScriptRunner = {
    isDestroyed: () => false,
    async executeJavaScript() {
      return { url: 'https://a.test/', title: 'A', readyState: 'complete', text: 'Hello   \n\n\n\nWorld and more' }
    }
  }
  const page = await readPageText(contents, { maxChars: 11 })
  assert.deepEqual(page, { url: 'https://a.test/', title: 'A', readyState: 'complete', text: 'Hello\n\nWorl', truncated: true })
})
