import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DOCK_PREFS, DOCK_REST, DOCK_HEIGHT, dockLocation, dockLocationLabel, pointerInDockBounds, pointerReveal, readDockPrefs,
  saveDockPrefs, trayApps, canPinTrayApp, isTrayAppPinned, setTrayAppPinned, pinnedTrayApps,
  DOCK_ICON_OPTIONS, dockIconPinPatch, isDockIconPinned, type TrayInput
} from './dock-model.js'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) }
  }
}

const quiet: TrayInput = {
  runningChats: 0, browserVisible: false, agentRuns: 0, runningAgentRuns: 0, agentSummary: 'No agents running',
  savedSites: 0, notes: 0, downloads: 0, activeDownloads: 0
}

describe('dock prefs', () => {
  it('round-trips and falls back field by field', () => {
    const storage = memoryStorage()
    assert.deepEqual(readDockPrefs(storage), DEFAULT_DOCK_PREFS)
    const prefs = { ...DEFAULT_DOCK_PREFS, hiddenTray: ['note' as const], pinnedTray: ['browser' as const] }
    saveDockPrefs(storage, prefs)
    assert.deepEqual(readDockPrefs(storage), prefs)
    assert.deepEqual(readDockPrefs(memoryStorage({ 'closedai.dock.v1': '{"keepVisible":"yes","magnify":false}' })),
      DEFAULT_DOCK_PREFS)
    assert.deepEqual(readDockPrefs(memoryStorage({ 'closedai.dock.v1': '{not json' })), DEFAULT_DOCK_PREFS)
  })

  it('migrates the hidden footer and seeds text links once, preserving later unpins', () => {
    const storage = memoryStorage({ 'closedai.dock.v1': '{"keepVisible":true,"pinnedTray":["agents"]}' })
    const migrated = readDockPrefs(storage)
    assert.deepEqual(migrated.pinnedTray, ['chats', 'browser', 'video', 'files', 'note', 'agents'])
    saveDockPrefs(storage, { ...migrated, pinnedTray: [] })
    assert.deepEqual(readDockPrefs(storage).pinnedTray, [])
  })

  it('pins only the launchers, keeps tray order, and ignores stacks', () => {
    assert.ok(canPinTrayApp('browser'))
    assert.ok(!canPinTrayApp('downloads'))
    // Toggle on out of order; the stored list stays in tray order.
    let pinned = setTrayAppPinned([], 'agents', true)
    pinned = setTrayAppPinned(pinned, 'chats', true)
    assert.deepEqual(pinned, ['chats', 'agents'])
    assert.ok(isTrayAppPinned('agents', pinned))
    // A stack can never be pinned, even if asked.
    assert.deepEqual(setTrayAppPinned(pinned, 'saved-sites', true), pinned)
    // Unpin drops just that one.
    assert.deepEqual(setTrayAppPinned(pinned, 'chats', false), ['agents'])
    // pinnedTrayApps returns the live TrayApp entries in tray order.
    assert.deepEqual(pinnedTrayApps(quiet, pinned).map((app) => app.id), ['chats', 'agents'])
  })

  it('migrates fixed shortcuts without repinning previously removed apps', () => {
    const storage = memoryStorage({ 'closedai.dock.v1': JSON.stringify({ railVersion: 2, pinnedTray: [] }) })
    const prefs = readDockPrefs(storage)
    assert.deepEqual(prefs.pinnedTray, [])
    assert.deepEqual(prefs.pinnedControls, ['workspaces', 'library', 'settings'])
  })

  it('can remove every dock icon, round-trip an empty dock, and restore each shortcut', () => {
    const storage = memoryStorage()
    let prefs = readDockPrefs(storage)
    for (const { id } of DOCK_ICON_OPTIONS) prefs = { ...prefs, ...dockIconPinPatch(prefs, id, false) }
    saveDockPrefs(storage, prefs)
    prefs = readDockPrefs(storage)
    assert.deepEqual(prefs.pinnedTray, [])
    assert.deepEqual(prefs.pinnedControls, [])
    assert.ok(DOCK_ICON_OPTIONS.every(({ id }) => !isDockIconPinned(prefs, id)))
    for (const { id } of DOCK_ICON_OPTIONS) prefs = { ...prefs, ...dockIconPinPatch(prefs, id, true) }
    saveDockPrefs(storage, prefs)
    assert.ok(DOCK_ICON_OPTIONS.every(({ id }) => isDockIconPinned(readDockPrefs(storage), id)))
    assert.deepEqual(readDockPrefs(storage).pinnedTray, ['chats', 'browser', 'video', 'files', 'note', 'agents'])
    assert.deepEqual(readDockPrefs(storage).pinnedControls, ['workspaces', 'library', 'settings'])
  })

  it('unpins one shortcut without touching other pins and filters invalid saved controls', () => {
    const prefs = { ...DEFAULT_DOCK_PREFS, ...dockIconPinPatch(DEFAULT_DOCK_PREFS, 'library', false) }
    assert.deepEqual(prefs.pinnedTray, DEFAULT_DOCK_PREFS.pinnedTray)
    assert.deepEqual(prefs.pinnedControls, ['workspaces', 'settings'])
    assert.deepEqual(dockIconPinPatch(prefs, 'note', false), { pinnedTray: ['chats', 'browser', 'video', 'files'] })
    const storage = memoryStorage({ 'closedai.dock.v1': JSON.stringify({
      railVersion: 2, pinnedTray: [], pinnedControls: ['library', 'codex', 'library', null, 'settings']
    }) })
    assert.deepEqual(readDockPrefs(storage).pinnedControls, ['library', 'settings'])
  })

  it('reserves the footer overlay height for layout math', () => {
    assert.equal(DOCK_REST, DOCK_HEIGHT)
  })
})

describe('pointerReveal', () => {
  const bounds = { left: 400, top: 820, right: 800, bottom: 900 }

  it('reveals only inside the control cluster box', () => {
    assert.equal(pointerReveal(600, 850, bounds, false), 'show')
    assert.equal(pointerReveal(399, 850, bounds, false), 'leave')
    assert.equal(pointerReveal(600, 819, bounds, false), 'leave')
    assert.equal(pointerReveal(600, 901, bounds, false), 'leave')
    assert.equal(pointerInDockBounds(400, 820, bounds), true)
    assert.equal(pointerInDockBounds(400, 819, bounds), false)
  })

  it('holds an open dock only while the pointer stays inside the box', () => {
    assert.equal(pointerReveal(600, 850, bounds, true), 'hold')
    assert.equal(pointerReveal(900, 850, bounds, true), 'leave')
    assert.equal(pointerReveal(600, 700, bounds, true), 'leave')
  })
})

describe('trayApps', () => {
  it('lists the surfaces in tray order with stacks marked', () => {
    const apps = trayApps(quiet)
    assert.deepEqual(apps.map((app) => app.id), ['chats', 'browser', 'video', 'files', 'note', 'agents', 'saved-sites', 'downloads'])
    assert.deepEqual(apps.filter((app) => app.stack).map((app) => app.id), ['saved-sites', 'downloads'])
    assert.ok(apps.every((app) => !app.active))
  })

  it('marks what is running or showing and says so', () => {
    const apps = Object.fromEntries(trayApps({
      ...quiet, runningChats: 2, browserVisible: true, agentRuns: 3, runningAgentRuns: 1,
      agentSummary: '1 running · 2 paused', savedSites: 1, downloads: 4, activeDownloads: 1
    }).map((app) => [app.id, app]))
    assert.equal(apps.chats!.active, true)
    assert.match(apps.chats!.note, /^2 running/)
    assert.equal(apps.browser!.active, true)
    assert.equal(apps.agents!.note, '1 running · 2 paused')
    assert.equal(apps['saved-sites']!.note, '1 site')
    assert.equal(apps.downloads!.note, '1 downloading')
    assert.equal(apps.downloads!.active, true)
  })

  it('counts settled downloads when nothing is moving', () => {
    const downloads = trayApps({ ...quiet, downloads: 3 }).find((app) => app.id === 'downloads')!
    assert.equal(downloads.note, '3 files')
    assert.equal(downloads.active, false)
  })
})

describe('dockLocation', () => {
  it('names the workspace and chat, or the overview', () => {
    assert.deepEqual(dockLocation({ overview: false, space: 'closedai', chat: 'Dock work' }), ['closedai', 'Dock work'])
    assert.deepEqual(dockLocation({ overview: false, space: 'closedai', chat: null }), ['closedai'])
    assert.deepEqual(dockLocation({ overview: true, space: 'closedai', chat: 'Dock work' }), ['All workspaces'])
  })

  it('joins breadcrumb parts for tooltips', () => {
    assert.equal(dockLocationLabel(['closedai', 'Dock work']), 'closedai › Dock work')
    assert.equal(dockLocationLabel(['All workspaces']), 'All workspaces')
  })
})

 it('adds Files to existing nonempty docks once and respects an explicit unpin', () => {
  const storage = memoryStorage({ 'closedai.dock.v1': JSON.stringify({ railVersion: 2, pinnedTray: ['browser'] }) })
  const migrated = readDockPrefs(storage)
  assert.deepEqual(migrated.pinnedTray, ['browser', 'files'])
  saveDockPrefs(storage, { ...migrated, pinnedTray: ['browser'] })
  assert.deepEqual(readDockPrefs(storage).pinnedTray, ['browser'])
  assert.equal(trayApps({ ...quiet, filesVisible: true }).find(app => app.id === 'files')?.active, true)
})
