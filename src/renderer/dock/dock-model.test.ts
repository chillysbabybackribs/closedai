import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DOCK_PREFS, DOCK_REACH, DOCK_RESERVE, DOCK_HEIGHT, TAB_RISE, TRAY_ICON, TRAY_LIFT, TRAY_MAGNIFIED, HOLD_BAND, REVEAL_EDGE, dockLocation, dockOutlinePath, pointerReveal, readDockPrefs,
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
  savedSites: 0, downloads: 0, activeDownloads: 0
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

  it('reserves room past the strip so a pinned dock never overlaps the browser edge margin', () => {
    // titlebar-browser-freeze.ts widens the browser box by 3px when testing overlap.
    assert.ok(DOCK_RESERVE - DOCK_REACH > 3)
  })

  it('reaches past a magnified tile and the tab, which rises above the strip over the resting tiles', () => {
    assert.ok(DOCK_REACH >= TRAY_LIFT + TRAY_MAGNIFIED)
    assert.ok(DOCK_REACH >= DOCK_HEIGHT + TAB_RISE)
    assert.ok(TAB_RISE > 0 && TRAY_LIFT + TRAY_ICON > DOCK_HEIGHT)
  })
})

describe('dockOutlinePath', () => {
  const box = { width: 1000, height: DOCK_HEIGHT + TAB_RISE, tabLeft: 400, tabWidth: 200 }
  const numbers = (path: string): number[] => path.match(/-?[\d.]+/g)!.map(Number)

  it('runs along the strip edge, over the tab, and back, symmetric about the tab centre', () => {
    const path = dockOutlinePath(box)
    assert.match(path, new RegExp(`^M 0 ${TAB_RISE} H [\\d.]+ A `))
    assert.match(path, / H 1000$/)
    const points = path.split(/ (?=[A-Z])/)
    const top = points.find((part) => part.startsWith('H') && Number(part.slice(2)) > box.tabLeft)!
    const [left, right] = [Number(points[1].slice(2)), Number(points.at(-2)!.split(' ').at(-2))]
    assert.equal(left + right, 2 * (box.tabLeft + box.tabWidth / 2))
    assert.ok(left < box.tabLeft, 'the join starts outside the tab')
    assert.ok(Number(top.slice(2)) < box.tabLeft + box.tabWidth)
    assert.ok(numbers(path).every((value) => Number.isFinite(value) && value >= 0 && value <= box.width))
  })

  it('closes round the strip bottom for the clip and insets the stroke inside the fill', () => {
    assert.match(dockOutlinePath(box, 0, true), new RegExp(` H 1000 V ${DOCK_HEIGHT + TAB_RISE} H 0 Z$`))
    assert.ok(dockOutlinePath(box, 0.5).startsWith(`M 0 ${TAB_RISE + 0.5} `))
    assert.match(dockOutlinePath(box, 0.5), / H [\d.]+ 0.5 | 0.5 H /)
  })

  it('keeps a straight side when the tab rises past both curves', () => {
    const tall = dockOutlinePath({ ...box, height: DOCK_HEIGHT + 60 })
    assert.match(tall, / L 400 \d+/)
    assert.ok(tall.includes('L 400 16'), 'the side runs up to where the top corner starts')
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
    assert.deepEqual(apps.map((app) => app.id), ['chats', 'browser', 'agents', 'saved-sites', 'downloads'])
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
})
