import assert from 'node:assert/strict'
import test from 'node:test'

import {
  channelsFrom,
  foldRecording,
  installInstrument,
  instrumentScript,
  INSTRUMENT_CHANNELS
} from './cdp-instrument.js'

test('channels default to every watcher and reject unknown names', () => {
  assert.deepEqual(channelsFrom([]), [...INSTRUMENT_CHANNELS])
  assert.deepEqual(channelsFrom(['cookie', 'fetch']), ['fetch', 'cookie'])
  assert.throws(() => channelsFrom(['nonsense']), /channels must name/)
})

test('the recorder script is syntactically valid and patches only the requested channels', () => {
  const everything = instrumentScript([...INSTRUMENT_CHANNELS], 100)
  assert.doesNotThrow(() => new Function(`return ${everything}`))
  assert.match(everything, /HTMLCanvasElement\.prototype\.toDataURL/)
  assert.match(everything, /XMLHttpRequest\.prototype\.open/)

  const cookiesOnly = instrumentScript(['cookie'], 10)
  assert.doesNotThrow(() => new Function(`return ${cookiesOnly}`))
  assert.match(cookiesOnly, /const CH = \["cookie"\]/)
  assert.match(cookiesOnly, /const CAP = 10/)
})

test('the recorder installs on the current document as well as the next one', async () => {
  const sent: string[] = []
  const result = await installInstrument(async (method) => {
    sent.push(method)
    if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: '7' }
    if (method === 'Runtime.evaluate') return { result: { value: 'installed' } }
    return {}
  }, ['fetch'], 50)

  assert.deepEqual(result, { identifier: '7', onCurrentDocument: 'installed' })
  assert.deepEqual(sent, ['Page.enable', 'Runtime.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Runtime.evaluate'])
})

test('a recording folds into exact counts, frequent calls and newest-first recent events', () => {
  const payload = JSON.stringify({
    installed: true,
    url: 'https://site/page',
    channels: ['fetch', 'cookie'],
    counts: { fetch: 9, cookie: 2 },
    dropped: 4,
    events: [
      { c: 'fetch', d: 'GET /api/a', t: 10 },
      { c: 'cookie', d: 'read', t: 20 },
      { c: 'fetch', d: 'GET /api/a', t: 30 },
      { c: 'fetch', d: 'GET /api/b', t: 40 }
    ]
  })
  const folded = foldRecording({ result: { value: payload } }, { limit: 2 })

  assert.equal(folded.installed, true)
  assert.equal(folded.url, 'https://site/page')
  assert.deepEqual(folded.counts, { fetch: 9, cookie: 2 })
  assert.equal(folded.dropped, 4)
  assert.deepEqual(folded.distinct, [
    { channel: 'fetch', detail: 'GET /api/a', count: 2 },
    { channel: 'cookie', detail: 'read', count: 1 }
  ])
  assert.deepEqual(folded.recent, [
    { channel: 'fetch', detail: 'GET /api/b', atMs: 40 },
    { channel: 'fetch', detail: 'GET /api/a', atMs: 30 }
  ])
})

test('a document with no recorder folds to installed false rather than throwing', () => {
  const missing = foldRecording({ result: { value: JSON.stringify({ installed: false }) } }, { limit: 5 })
  assert.deepEqual(missing, { installed: false, counts: {}, dropped: 0, distinct: [], recent: [] })
  assert.equal(foldRecording(undefined, { limit: 5 }).installed, false)
  assert.equal(foldRecording({ result: { value: 'not json' } }, { limit: 5 }).installed, false)
})
