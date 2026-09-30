import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DOCK_PREFS, DOCK_REACH, DOCK_REST, DOCK_RESERVE, DOCK_HEIGHT, TRAY_ICON, TRAY_LIFT, TRAY_MAGNIFIED, HOLD_BAND, REVEAL_EDGE, dockLocation, dockLocationLabel, pointerReveal, readDockPrefs,
  saveDockPrefs, trayApps, type TrayInput
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
    saveDockPrefs(storage, { keepVisible: true, magnify: false })
    assert.deepEqual(readDockPrefs(storage), { keepVisible: true, magnify: false })
    assert.deepEqual(readDockPrefs(memoryStorage({ 'closedai.dock.v1': '{"keepVisible":"yes","magnify":false}' })),
      { keepVisible: false, magnify: false })
    assert.deepEqual(readDockPrefs(memoryStorage({ 'closedai.dock.v1': '{not json' })), DEFAULT_DOCK_PREFS)
  })

  it('reserves room past the resting tiles so a pinned dock never overlaps the browser edge margin', () => {
    // titlebar-browser-freeze.ts widens the browser box by 3px when testing overlap.
    assert.ok(DOCK_RESERVE - DOCK_REST > 3)
  })

  it('stands the resting tiles out of the flat strip, and a magnified tile reaches further', () => {
    assert.ok(TRAY_LIFT + TRAY_ICON > DOCK_HEIGHT)
    assert.ok(DOCK_REACH >= TRAY_LIFT + TRAY_MAGNIFIED)
    assert.ok(DOCK_REACH > DOCK_REST)
  })
})

describe('pointerReveal', () => {
  const height = 900
  it('shows at the bottom edge only', () => {
    assert.equal(pointerReveal(height - 1, height, false), 'show')
    assert.equal(pointerReveal(height - REVEAL_EDGE, height, false), 'show')
    assert.equal(pointerReveal(height - REVEAL_EDGE - 1, height, false), 'leave')
  })

  it('holds a shown dock while the pointer is over or just above it', () => {
    assert.equal(pointerReveal(height - 30, height, true), 'hold')
    assert.equal(pointerReveal(height - HOLD_BAND, height, true), 'hold')
    assert.equal(pointerReveal(height - HOLD_BAND - 1, height, true), 'leave')
    assert.equal(pointerReveal(height - 30, height, false), 'leave')
  })
})

describe('trayApps', () => {
  it('lists the surfaces in tray order with stacks marked', () => {
    const apps = trayApps(quiet)
    assert.deepEqual(apps.map((app) => app.id), ['chats', 'browser', 'note', 'agents', 'saved-sites', 'downloads'])
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
