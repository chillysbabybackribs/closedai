import assert from 'node:assert/strict'
import test from 'node:test'
import { ScreenshotStore, type StoredScreenshot } from './screenshot-store.js'

function shot(bytes: number): StoredScreenshot {
  return {
    dataUrl: 'x'.repeat(bytes), width: 10, height: 10, modelWidth: 10, modelHeight: 10,
    surface: 'app_window', capturedAt: '2026-09-02T12:00:00.000Z'
  }
}

test('keeps the newest captures within the entry and byte limits', () => {
  const store = new ScreenshotStore(2, 1_000)
  store.retain('a', shot(100))
  store.retain('b', shot(100))
  store.retain('c', shot(100))
  assert.equal(store.get('a'), null)
  assert.equal(store.get('b')?.dataUrl.length, 100)
  assert.equal(store.get('c')?.dataUrl.length, 100)
  assert.equal(store.size, 2)

  store.retain('d', shot(950))
  assert.equal(store.size, 1)
  assert.equal(store.get('d')?.dataUrl.length, 950)
})

test('re-retaining an id replaces the entry and counts bytes once', () => {
  const store = new ScreenshotStore(5, 300)
  store.retain('a', shot(200))
  store.retain('a', shot(250))
  store.retain('b', shot(40))
  assert.equal(store.size, 2)
  assert.equal(store.get('a')?.dataUrl.length, 250)
  store.retain('', shot(10))
  assert.equal(store.size, 2)
})
