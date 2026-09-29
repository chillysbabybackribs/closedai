import assert from 'node:assert/strict'
import test from 'node:test'
import { MENUS, launcherGroups, menuItemDisabled, type MenuItem } from './application-menu-model.ts'

const items = MENUS.flatMap(menu => menu.rows.filter((row): row is MenuItem => 'key' in row))
const state = { chatZoom: 100, tileEnabled: false, layoutEnabled: false, compactEnabled: false, stopEnabled: false }

test('each existing action is reachable in its category and through command search', () => {
  for (const menu of MENUS) {
    assert.deepEqual(launcherGroups(menu.key, '').flatMap(group => group.rows), menu.rows.filter(row => 'key' in row))
  }
  for (const row of items) {
    assert.ok(launcherGroups('home', row.label).flatMap(group => group.rows).some(candidate => 'key' in candidate && candidate.key === row.key))
  }
  assert.deepEqual(launcherGroups('file', '  nonexistent command  '), [])
  assert.ok(launcherGroups('home', '  DEVELOPER ').every(group => group.key === 'developer'))
})

test('launcher preserves context eligibility and zoom limits', () => {
  const disabled = (key: string, patch = {}) => menuItemDisabled(items.find(row => row.key === key)!, { ...state, ...patch })
  assert.equal(disabled('new-chat'), false)
  for (const key of ['tile-windows', 'workspace-layout', 'toggle-browser-pane', 'compact-context', 'stop-turn']) {
    assert.equal(disabled(key), true, key)
  }
  assert.equal(disabled('stop-turn', { stopEnabled: true }), false)
  assert.equal(disabled('compact-context', { compactEnabled: true }), false)
  assert.equal(disabled('zoom-in', { chatZoom: 200 }), true)
  assert.equal(disabled('zoom-out', { chatZoom: 50 }), true)
  assert.equal(disabled('reset-zoom'), true)
})
