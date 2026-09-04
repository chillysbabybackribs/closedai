import assert from 'node:assert/strict'
import test from 'node:test'
import { ScreenshotStore, type StoredScreenshot } from './screenshot-store.js'

// The store holds decoded bytes, so a fixture is a real data URL and its size is the byte count
// the limits are measured in — not the length of the base64 text around them.
function shot(bytes: number, mediaType = 'image/png'): StoredScreenshot {
  return {
    dataUrl: `data:${mediaType};base64,${Buffer.alloc(bytes, 7).toString('base64')}`,
    width: 10, height: 10, modelWidth: 10, modelHeight: 10,
    surface: 'app_window', capturedAt: '2026-09-02T12:00:00.000Z'
  }
}

function bytesOf(screenshot: StoredScreenshot | null): number {
  const base64 = /^data:[^;,]+;base64,(.*)$/s.exec(screenshot?.dataUrl ?? '')?.[1]
  return base64 === undefined ? -1 : Buffer.from(base64, 'base64').length
}

test('keeps the newest captures within the entry and byte limits', () => {
  const store = new ScreenshotStore(2, 1_000)
  store.retain('a', shot(100))
  store.retain('b', shot(100))
  store.retain('c', shot(100))
  assert.equal(store.get('a'), null)
  assert.equal(bytesOf(store.get('b')), 100)
  assert.equal(bytesOf(store.get('c')), 100)
  assert.equal(store.size, 2)

  store.retain('d', shot(950))
  assert.equal(store.size, 1)
  assert.equal(bytesOf(store.get('d')), 950)
})

test('a capture comes back as the media type it went in as', () => {
  const store = new ScreenshotStore()
  // The display copy is a PNG and the model copy a JPEG; rebuilding both as one fixed type
  // would hand the renderer a payload labelled as something it is not.
  store.retain('png', shot(32, 'image/png'))
  store.retain('jpeg', shot(32, 'image/jpeg'))
  assert.match(store.get('png')!.dataUrl, /^data:image\/png;base64,/)
  assert.match(store.get('jpeg')!.dataUrl, /^data:image\/jpeg;base64,/)
  assert.equal(bytesOf(store.get('png')), 32)
})

test('re-retaining an id replaces the entry and counts bytes once', () => {
  const store = new ScreenshotStore(5, 300)
  store.retain('a', shot(200))
  store.retain('a', shot(250))
  store.retain('b', shot(40))
  assert.equal(store.size, 2)
  assert.equal(bytesOf(store.get('a')), 250)
  store.retain('', shot(10))
  assert.equal(store.size, 2)
})
