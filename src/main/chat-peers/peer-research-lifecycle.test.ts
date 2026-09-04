import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatPeerManager } from './peer-manager.js'
import { FakeSurface, harness } from './peer-manager-harness.js'

test('Stop cancels app-owned pane work before waiting for the provider; detachment also cancels', async (t) => {
  const base = harness()
  base.manager.stop()
  const cancelled: string[] = []
  const surfaces: FakeSurface[] = []
  const manager = new ChatPeerManager(base.settings, base.store, (_settings, record) => {
    const surface = new FakeSurface(record.modelId)
    surfaces.push(surface)
    return surface
  }, undefined, undefined, undefined, (paneId) => cancelled.push(paneId))
  t.after(() => manager.stop())
  let release!: () => void
  surfaces[0].interrupt = () => new Promise<void>((resolve) => { release = resolve })
  const stopping = manager.interrupt('pane-a')
  assert.deepEqual(cancelled, ['pane-a'])
  await new Promise<void>((resolve) => setImmediate(resolve))
  release()
  await stopping
  await manager.newPeer()
  await manager.closePeer('pane-a')
  assert.equal(cancelled.filter((id) => id === 'pane-a').length, 2)
})
