import assert from 'node:assert/strict'
import test from 'node:test'
import { APP_MENU_KEYS } from '../shared/app-menu-run.ts'
import { MENUS, launcherGroups, menuItemDisabled, runMenuKey, type MenuItem, type TitlebarMenuProps } from './application-menu-model.ts'

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
  assert.equal(disabled('zoom-in', { chatZoom: 250 }), true)
  assert.equal(disabled('zoom-out', { chatZoom: 50 }), true)
  assert.equal(disabled('reset-zoom'), true)
})

test('the shared model key list names every menu row and nothing else', () => {
  assert.deepEqual(items.map(row => row.key).sort(), [...APP_MENU_KEYS].sort())
  assert.equal(new Set(items.map(row => row.key)).size, items.length)
})

test('a model run fires the row handler only when the menu would allow the click', () => {
  const fired: unknown[] = []
  const menu: TitlebarMenuProps = {
    ...state, chatZoom: 110, stopEnabled: true, selectedChatTitle: null,
    onChatZoomChange: (command) => fired.push(['zoom', command]),
    onAction: (action) => fired.push(['action', action]),
    onSearchChats: () => fired.push(['search']),
    onApplyLayoutPreset: (preset) => fired.push(['preset', preset])
  }
  const chat = { selectedPaneId: 'pane-a', callerPaneId: 'pane-b' }
  assert.deepEqual(runMenuKey('tools', menu, chat), { key: 'tools', label: 'Tools & capabilities…', menu: 'Agent', ran: true })
  assert.equal(runMenuKey('reset-zoom', menu, chat).ran, true)
  assert.equal(runMenuKey('search-chats', menu, chat).ran, true)
  assert.deepEqual(runMenuKey('tile-windows', menu, chat), { key: 'tile-windows', label: 'Tile windows (full workspace)', menu: 'View', ran: false, disabled: true })
  assert.match(runMenuKey('missing', menu, chat).refused ?? '', /No menu row/)
  assert.equal(runMenuKey('stop-turn', menu, chat).ran, true)
  const self = runMenuKey('stop-turn', menu, { selectedPaneId: 'pane-b', callerPaneId: 'pane-b' })
  assert.equal(self.ran, false)
  assert.match(self.refused ?? '', /calling chat/)
  assert.deepEqual(fired, [['action', 'tools'], ['zoom', 'reset'], ['search'], ['action', 'stop-turn']])
  const focusedView = { selectedPaneId: 'pane-b', callerPaneId: 'pane-b', closeTargetId: 'closedai:view:tools:1' }
  assert.equal(runMenuKey('close-tab', menu, focusedView).ran, true)
  assert.deepEqual(fired.at(-1), ['action', 'close-tab'])
  assert.equal(runMenuKey('stop-turn', menu, focusedView).ran, false)
  assert.equal(runMenuKey('close-tab', menu, { ...focusedView, closeTargetId: 'pane-b' }).ran, false)
})
