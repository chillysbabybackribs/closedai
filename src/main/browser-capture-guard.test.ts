import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { withCaptureDocument } from './browser-capture-guard.js'

function harness() {
  const emitter = new EventEmitter()
  const contents = Object.assign(emitter, { isDestroyed: () => false })
  // Electron's event overloads expose more events than this focused EventEmitter fixture.
  const host = contents as unknown as Parameters<typeof withCaptureDocument>[0]
  return { emitter, host }
}

test('stable page returns its image and removes all listeners', async () => {
  const { emitter, host } = harness()
  assert.equal(await withCaptureDocument(host, async () => 'image'), 'image')
  assert.deepEqual(emitter.eventNames(), [])
})

test('main-frame navigation, reload and same-document navigation invalidate capture', async () => {
  for (const inPlace of [false, true]) {
    const { emitter, host } = harness()
    await assert.rejects(withCaptureDocument(host, async () => {
      emitter.emit('did-start-navigation', {}, 'https://same.test/', inPlace, true)
      return 'image'
    }), /main page navigated/)
    assert.deepEqual(emitter.eventNames(), [])
  }
})

test('away and back before capture resolves still invalidates the image', async () => {
  const { emitter, host } = harness()
  await assert.rejects(withCaptureDocument(host, async () => {
    emitter.emit('did-start-navigation', {}, 'https://other.test/', false, true)
    await Promise.resolve()
    emitter.emit('did-start-navigation', {}, 'https://same.test/', false, true)
    return 'image'
  }), /main page navigated/)
  assert.deepEqual(emitter.eventNames(), [])
})

test('subframe navigation is outside the main-document guarantee', async () => {
  const { emitter, host } = harness()
  assert.equal(await withCaptureDocument(host, async () => {
    emitter.emit('did-start-navigation', {}, 'https://frame.test/', false, false)
    return 'image'
  }), 'image')
  assert.deepEqual(emitter.eventNames(), [])
})

test('renderer loss and destruction discard images and release listeners', async () => {
  for (const event of ['render-process-gone', 'destroyed']) {
    const { emitter, host } = harness()
    await assert.rejects(withCaptureDocument(host, async () => {
      emitter.emit(event)
      return 'image'
    }), /renderer disappeared/)
    assert.deepEqual(emitter.eventNames(), [])
  }
})

test('capture failure preserves the error and releases listeners', async () => {
  const { emitter, host } = harness()
  await assert.rejects(withCaptureDocument(host, async () => {
    throw new Error('capture failed')
  }), /capture failed/)
  assert.deepEqual(emitter.eventNames(), [])
})

test('already destroyed contents never invoke capture or arm listeners', async () => {
  const { emitter, host } = harness()
  host.isDestroyed = () => true
  await assert.rejects(withCaptureDocument(host, async () => assert.fail('must not capture')), /tab closed/)
  assert.deepEqual(emitter.eventNames(), [])
})
