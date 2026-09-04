import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import {
  BrowserTabSessionStore,
  MAX_RESTORED_TABS,
  normalizeSession,
  restorePlan,
  selectPersistableTabs
} from './browser-tab-session-store.ts'
import type { BrowserTabInfo } from '../shared/types.ts'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function sessionFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tab-session-'))
  dirs.push(dir)
  return join(dir, 'browser-tabs.json')
}

function tab(url: string, options: { title?: string; customTitle?: string | null; active?: boolean } = {}): BrowserTabInfo {
  return {
    id: `tab-${url}`,
    pos: 1,
    title: options.title ?? '',
    customTitle: options.customTitle,
    url,
    favicon: null,
    isLoading: false,
    active: options.active === true
  }
}

describe('selectPersistableTabs', () => {
  it('keeps order and marks the active tab', () => {
    const session = selectPersistableTabs([
      tab('https://a.example/', { title: 'A' }),
      tab('https://b.example/', { title: 'B', active: true })
    ])
    assert.deepEqual(session.tabs, [
      { url: 'https://a.example/', title: 'A' },
      { url: 'https://b.example/', title: 'B' }
    ])
    assert.equal(session.activeIndex, 1)
  })

  it('persists a custom tab title separately from the page title', () => {
    const session = selectPersistableTabs([
      tab('https://a.example/', { title: 'Page A', customTitle: 'Pinned A', active: true })
    ])
    assert.deepEqual(session.tabs, [
      { url: 'https://a.example/', title: 'Page A', customTitle: 'Pinned A' }
    ])
    assert.equal(session.activeIndex, 0)
  })

  it('drops unrestorable urls and renumbers the active index against what is kept', () => {
    const session = selectPersistableTabs([
      tab('about:blank'),
      tab('https://keep.example/'),
      tab('file:///tmp/x.html'),
      tab('https://active.example/', { active: true })
    ])
    assert.deepEqual(
      session.tabs.map((entry) => entry.url),
      ['https://keep.example/', 'https://active.example/']
    )
    assert.equal(session.activeIndex, 1)
  })

  it('returns an empty session when nothing is restorable', () => {
    assert.deepEqual(selectPersistableTabs([tab('about:blank', { active: true })]), {
      tabs: [],
      activeIndex: 0,
      droppedToCap: 0
    })
  })

  it('reports how many tabs the cap dropped', () => {
    const many = Array.from({ length: MAX_RESTORED_TABS + 7 }, (_unused, index) =>
      tab(`https://site-${index}.example/`, { active: index === 0 })
    )
    assert.equal(selectPersistableTabs(many).droppedToCap, 7)
    assert.equal(selectPersistableTabs(many.slice(0, MAX_RESTORED_TABS)).droppedToCap, 0)
  })

  it('caps the strip on a window that still contains the active tab', () => {
    const many = Array.from({ length: MAX_RESTORED_TABS + 20 }, (_unused, index) =>
      tab(`https://site-${index}.example/`, { active: index === MAX_RESTORED_TABS + 10 })
    )
    const session = selectPersistableTabs(many)
    assert.equal(session.tabs.length, MAX_RESTORED_TABS)
    assert.equal(session.tabs[session.activeIndex].url, `https://site-${MAX_RESTORED_TABS + 10}.example/`)
  })

  it('keeps the active tab when it is the very last of an over-cap strip', () => {
    const many = Array.from({ length: MAX_RESTORED_TABS + 5 }, (_unused, index) =>
      tab(`https://site-${index}.example/`, { active: index === MAX_RESTORED_TABS + 4 })
    )
    const session = selectPersistableTabs(many)
    assert.equal(session.tabs.length, MAX_RESTORED_TABS)
    assert.equal(session.activeIndex, MAX_RESTORED_TABS - 1)
    assert.equal(session.tabs[session.activeIndex].url, `https://site-${MAX_RESTORED_TABS + 4}.example/`)
  })
})

describe('normalizeSession', () => {
  it('rejects a foreign or unversioned payload', () => {
    assert.equal(normalizeSession(null), null)
    assert.equal(normalizeSession({ tabs: [] }), null)
    assert.equal(normalizeSession({ version: 2, tabs: [] }), null)
    assert.equal(normalizeSession({ version: 1, tabs: 'nope' }), null)
  })

  it('drops malformed entries instead of failing the whole restore', () => {
    const session = normalizeSession({
      version: 1,
      tabs: [{ url: 'https://ok.example/', title: 'Ok' }, { url: 42 }, null, { title: 'no url' }],
      activeIndex: 0
    })
    assert.deepEqual(session, { version: 1, tabs: [{ url: 'https://ok.example/', title: 'Ok' }], activeIndex: 0 })
  })

  it('normalizes custom titles on restore', () => {
    const session = normalizeSession({
      version: 1,
      tabs: [
        { url: 'https://named.example/', title: 'Real', customTitle: '  Workbench  ' },
        { url: 'https://blank.example/', title: 'Blank', customTitle: '   ' }
      ],
      activeIndex: 0
    })
    assert.deepEqual(session?.tabs, [
      { url: 'https://named.example/', title: 'Real', customTitle: 'Workbench' },
      { url: 'https://blank.example/', title: 'Blank' }
    ])
  })

  it('clamps an out-of-range active index', () => {
    const tabs = [{ url: 'https://a.example/', title: '' }]
    assert.equal(normalizeSession({ version: 1, tabs, activeIndex: 99 })?.activeIndex, 0)
    assert.equal(normalizeSession({ version: 1, tabs, activeIndex: -3 })?.activeIndex, 0)
    assert.equal(normalizeSession({ version: 1, tabs: [], activeIndex: 5 })?.activeIndex, 0)
  })
})

describe('BrowserTabSessionStore', () => {
  it('starts clean when no file exists', async () => {
    const store = await BrowserTabSessionStore.open(await sessionFile())
    assert.equal(store.restored(), null)
  })

  it('starts clean on a corrupt file rather than throwing', async () => {
    const filePath = await sessionFile()
    await writeFile(filePath, '{ not json')
    const store = await BrowserTabSessionStore.open(filePath)
    assert.equal(store.restored(), null)
  })

  it('round-trips the strip across a restart', async () => {
    const filePath = await sessionFile()
    const store = await BrowserTabSessionStore.open(filePath)
    store.save([
      tab('https://a.example/', { title: 'A' }),
      tab('https://b.example/', { title: 'B', active: true })
    ])
    await store.flush()

    const reopened = await BrowserTabSessionStore.open(filePath)
    assert.deepEqual(reopened.restored(), {
      tabs: [
        { url: 'https://a.example/', title: 'A' },
        { url: 'https://b.example/', title: 'B' }
      ],
      activeIndex: 1
    })
  })

  it('reports the live strip so a reopened window restores what was last open', async () => {
    const store = await BrowserTabSessionStore.open(await sessionFile())
    store.save([tab('https://one.example/', { active: true })])
    store.save([tab('https://one.example/'), tab('https://two.example/', { active: true })])
    assert.deepEqual(store.restored()?.tabs.map((entry) => entry.url), [
      'https://one.example/',
      'https://two.example/'
    ])
  })

  it('ignores saves after close so teardown cannot erase the session', async () => {
    const filePath = await sessionFile()
    const store = await BrowserTabSessionStore.open(filePath)
    store.save([tab('https://keep.example/', { title: 'Keep', active: true })])
    await store.close()
    store.save([])
    await store.flush()

    const reopened = await BrowserTabSessionStore.open(filePath)
    assert.deepEqual(reopened.restored()?.tabs, [{ url: 'https://keep.example/', title: 'Keep' }])
  })

  it('writes the debounced session without an explicit flush', async () => {
    const filePath = await sessionFile()
    const store = await BrowserTabSessionStore.open(filePath)
    store.save([tab('https://crash.example/', { title: 'Crash', active: true })])
    // The debounce is what covers a crash: nothing calls flush() in that path.
    await new Promise((resolve) => setTimeout(resolve, 600))
    const written = JSON.parse(await readFile(filePath, 'utf8'))
    assert.deepEqual(written.tabs, [{ url: 'https://crash.example/', title: 'Crash' }])
  })
})

describe('restorePlan', () => {
  it('loads the tab the user will see before its neighbours', () => {
    assert.deepEqual(restorePlan(4, 2), { activeIndex: 2, loadOrder: [2, 0, 1, 3] })
  })

  it('loads a single tab as itself', () => {
    assert.deepEqual(restorePlan(1, 0), { activeIndex: 0, loadOrder: [0] })
  })

  it('clamps an active index a hand-edited file put out of range', () => {
    assert.deepEqual(restorePlan(3, 9), { activeIndex: 2, loadOrder: [2, 0, 1] })
    assert.deepEqual(restorePlan(3, -4), { activeIndex: 0, loadOrder: [0, 1, 2] })
  })

  it('plans nothing for an empty session', () => {
    assert.deepEqual(restorePlan(0, 0), { activeIndex: 0, loadOrder: [] })
  })

  it('covers every tab exactly once', () => {
    const { loadOrder } = restorePlan(7, 5)
    assert.deepEqual([...loadOrder].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6])
  })
})
