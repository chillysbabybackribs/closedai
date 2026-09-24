import assert from 'node:assert/strict'
import test from 'node:test'
import { paneHideHint, removalNotice, tabCloseHint } from './layout-copy.js'

test('tab close hints name running and paused work without implying a stop', () => {
  assert.equal(tabCloseHint('working'), 'Task keeps running')
  assert.equal(tabCloseHint('paused'), 'Task stays paused')
  assert.equal(tabCloseHint('idle'), 'Does not stop tasks')
  assert.equal(tabCloseHint(), 'Does not stop tasks')
})

test('pane hide hints prefer running over paused across the tile', () => {
  assert.equal(paneHideHint(['paused', 'working']), 'Tasks keep running')
  assert.equal(paneHideHint(['idle', 'paused']), 'Tasks stay paused')
  assert.equal(paneHideHint(['failed', 'unread']), 'Does not stop tasks')
})

test('removal notices identify continuing or paused tasks after pane hide', () => {
  assert.equal(removalNotice('Pane hidden', [{ paused: true }]), 'Pane hidden · Tasks remain paused')
})
