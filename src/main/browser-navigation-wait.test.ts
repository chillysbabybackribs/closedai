import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { waitForUsableLoad, type DomReadySource } from './browser-navigation-wait.ts'

function fakeContents(): EventEmitter & DomReadySource {
  return new EventEmitter()
}

const never = new Promise<void>(() => {})

test('resolves shortly after dom-ready instead of waiting for the full load', async () => {
  const contents = fakeContents()
  const started = Date.now()
  const wait = waitForUsableLoad(contents, never, 10, 5_000)
  contents.emit('dom-ready')
  await wait
  assert.ok(Date.now() - started < 1_000, 'did not wait for the never-finishing load')
  assert.equal(contents.listenerCount('dom-ready'), 0, 'listener cleaned up')
})

test('a main-frame load failure still rejects', async () => {
  const contents = fakeContents()
  const failure = Object.assign(new Error('ERR_NAME_NOT_RESOLVED'), { errno: -105 })
  await assert.rejects(waitForUsableLoad(contents, Promise.reject(failure), 10, 5_000), /ERR_NAME_NOT_RESOLVED/)
  assert.equal(contents.listenerCount('dom-ready'), 0)
})

test('a fast successful load resolves without dom-ready', async () => {
  const contents = fakeContents()
  await waitForUsableLoad(contents, Promise.resolve(), 10_000, 10_000)
  assert.equal(contents.listenerCount('dom-ready'), 0)
})

test('the hard cap unblocks a page that never reaches dom-ready', async () => {
  const contents = fakeContents()
  const started = Date.now()
  await waitForUsableLoad(contents, never, 10_000, 20)
  assert.ok(Date.now() - started < 5_000)
  assert.equal(contents.listenerCount('dom-ready'), 0)
})

test('a settle signal ends the tail early instead of sleeping the full fixed wait', async () => {
  const contents = fakeContents()
  const started = Date.now()
  const wait = waitForUsableLoad(contents, never, 5_000, 20_000, () => Promise.resolve())
  contents.emit('dom-ready')
  await wait
  assert.ok(Date.now() - started < 2_000, 'signal beat the 5s fixed settle')
  assert.equal(contents.listenerCount('dom-ready'), 0)
})

test('a failing settle signal falls back to the full fixed wait, never shorter', async () => {
  const contents = fakeContents()
  const started = Date.now()
  const wait = waitForUsableLoad(contents, never, 60, 20_000, () => Promise.reject(new Error('probe died')))
  contents.emit('dom-ready')
  await wait
  assert.ok(Date.now() - started >= 55, 'probe failure must not cut the settle short')
  assert.equal(contents.listenerCount('dom-ready'), 0)
})

test('a hanging settle signal is capped by the fixed wait', async () => {
  const contents = fakeContents()
  const started = Date.now()
  const wait = waitForUsableLoad(contents, never, 60, 20_000, () => new Promise<void>(() => {}))
  contents.emit('dom-ready')
  await wait
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 55 && elapsed < 5_000, `hung probe falls back to the fixed tail (took ${elapsed}ms)`)
})
