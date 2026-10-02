import assert from 'node:assert/strict'
import test from 'node:test'
import { VideoTab, videoKey } from './video-tab.js'

test('video tab snapshots expose identity and file URL without embedding bytes', () => {
  const tab = new VideoTab('tab-9', '/tmp/demo.mp4', { name: 'demo.mp4', path: '/tmp/demo.mp4', src: 'file:///tmp/demo.mp4', revision: 0 }, 'tab-1')
  assert.deepEqual(tab.getState().video, { tabId: 'tab-9', name: 'demo.mp4', path: '/tmp/demo.mp4', revision: 0 })
  tab.reload()
  assert.equal(tab.getState().video?.revision, 1)
  assert.equal(tab.getState().url, 'file:///tmp/demo.mp4')
  assert.equal(videoKey(tab.content), '/tmp/demo.mp4')
  tab.rename('Product demo')
  assert.equal(tab.getCustomTitle(), 'Product demo')
})
