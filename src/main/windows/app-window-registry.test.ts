import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import { AppWindowRegistry, type RegistryWindow } from './app-window-registry.js'
import { AppWindowStore } from './app-window-store.js'

type Sent = { channel: string; payload: unknown }

class FakeWindow {
  static nextId = 1
  readonly sent: Sent[] = []
  readonly handlers = new Map<string, Array<() => void>>()
  destroyed = false
  focused = false
  shown = 0
  readonly webContents = {
    id: FakeWindow.nextId++,
    isDestroyed: () => this.destroyed,
    send: (channel: string, payload: unknown) => { this.sent.push({ channel, payload }) }
  }
  isDestroyed = (): boolean => this.destroyed
  isFocused = (): boolean => this.focused
  isMaximized = (): boolean => false
  isMinimized = (): boolean => false
  restore = (): void => {}
  show = (): void => { this.shown += 1 }
  focus = (): void => { this.focused = true }
  getBounds = () => ({ x: 0, y: 0, width: 800, height: 600 })
  on = (event: string, handler: () => void) => {
    this.handlers.set(event, [...this.handlers.get(event) ?? [], handler])
    return this
  }
  close = (): void => {
    if (this.destroyed) return
    for (const handler of this.handlers.get('close') ?? []) handler()
    this.destroyed = true
    for (const handler of this.handlers.get('closed') ?? []) handler()
  }
  commands(): unknown[] {
    return this.sent.filter((entry) => entry.channel === 'windows:event' && (entry.payload as { type: string }).type === 'command')
      .map((entry) => (entry.payload as { command: unknown }).command)
  }
}

function harness(records: ConstructorParameters<typeof AppWindowRegistry>[0]['store'] = AppWindowStore.inMemory(), selectedChat: string | null = null) {
  const opened = new Map<string, FakeWindow>()
  const activated = new Map<string, boolean>()
  const forgotten: string[] = []
  const released: string[] = []
  let cwd = '/project'
  const registry = new AppWindowRegistry({
    store: records,
    openWindow: (id, activate) => {
      const window = new FakeWindow()
      opened.set(id, window)
      activated.set(id, activate)
      return window as unknown as RegistryWindow
    },
    forgetPlacement: (id) => { forgotten.push(id) },
    releaseChats: (id) => { released.push(id) },
    workspaceCwd: () => cwd,
    selectedChat: () => selectedChat
  })
  const main = new FakeWindow()
  registry.attachMain(main as unknown as RegistryWindow)
  return { registry, main, opened, activated, forgotten, released, store: records, setCwd: (next: string) => { cwd = next } }
}

const paneEvent = (paneId: string): ChatWorkspaceEvent => ({ type: 'pane', paneId, event: { type: 'turn', turnId: 't' } } as ChatWorkspaceEvent)

test('detaching moves the tabs into a new window that opens with them', () => {
  const { registry, main, opened, store } = harness()
  registry.claim('main', ['a', 'b'], ['a', 'b'])
  const id = registry.detach(main.webContents, '/project', ['b'])
  assert.deepEqual(registry.context(opened.get(id)!.webContents), { id, main: false, cwd: '/project', initialTabs: ['b'] })
  assert.deepEqual(registry.list().map((entry) => [entry.id, entry.tabIds]), [['main', ['a']], [id, ['b']]])
  assert.deepEqual(store.list(), [{ id, cwd: '/project', tabIds: ['b'] }])
})

test('at launch only the reopened window holding the selected chat takes focus', () => {
  const store = AppWindowStore.inMemory()
  store.put({ id: 'w1', cwd: '/project', tabIds: ['a'] })
  store.put({ id: 'w2', cwd: '/project', tabIds: ['b', 'c'] })
  const { registry, activated } = harness(store, 'c')
  registry.restore('/project')
  assert.deepEqual([...activated], [['w1', false], ['w2', true]])
})

test('detaching refuses a stale project', () => {
  const { registry, main, setCwd } = harness()
  setCwd('/other')
  assert.throws(() => registry.detach(main.webContents, '/project', ['a']), /project changed/)
})

test('transcript events reach only the window showing the chat, the rest reach every window', () => {
  const { registry, main, opened } = harness()
  const id = registry.detach(main.webContents, '/project', ['b'])
  const detached = opened.get(id)!
  registry.claim('main', ['a'], ['a'])
  registry.claim(id, ['b'], ['b'])
  main.sent.length = 0
  detached.sent.length = 0
  registry.sendChatEvent(paneEvent('b'))
  registry.sendChatEvent(paneEvent('hidden'))
  registry.sendChatEvent({ type: 'chats' } as unknown as ChatWorkspaceEvent)
  assert.deepEqual(detached.sent.map((entry) => (entry.payload as { paneId?: string; type: string }).paneId ?? entry.payload), ['b', { type: 'chats' }])
  assert.deepEqual(main.sent.map((entry) => (entry.payload as { paneId?: string }).paneId ?? 'workspace'), ['hidden', 'workspace'])
})

test('browser state stays in the main window', () => {
  const { registry, main, opened } = harness()
  const detached = opened.get(registry.detach(main.webContents, '/project', ['b']))!
  main.sent.length = 0
  detached.sent.length = 0
  registry.send('browser:tabs', [])
  registry.send('savedSites:changed', [])
  assert.deepEqual(main.sent.map((entry) => entry.channel), ['browser:tabs', 'savedSites:changed'])
  assert.deepEqual(detached.sent.map((entry) => entry.channel), ['savedSites:changed'])
})

test('closing a detached window hands its chats back and forgets it', () => {
  const { registry, main, opened, forgotten, released, store } = harness()
  const id = registry.detach(main.webContents, '/project', ['b'])
  registry.claim(id, ['b'], ['b', 'c'])
  opened.get(id)!.close()
  assert.deepEqual(main.commands(), [{ type: 'adoptTabs', tabIds: ['b', 'c'] }])
  assert.deepEqual(store.list(), [])
  assert.deepEqual(forgotten, [id])
  assert.deepEqual(released, [id])
  assert.deepEqual(registry.list().map((entry) => entry.id), ['main'])
})

test('quitting keeps detached windows for the next launch', () => {
  const { registry, main, opened, store } = harness()
  const id = registry.detach(main.webContents, '/project', ['b'])
  main.close()
  assert.equal(opened.get(id)!.destroyed, true)
  assert.deepEqual(main.commands(), [])
  assert.deepEqual(store.list().map((record) => record.id), [id])
})

test('switching projects closes other projects’ windows and reopens this project’s', () => {
  const store = AppWindowStore.inMemory([{ id: 'w-old', cwd: '/old', tabIds: ['x'] }])
  const { registry, main, opened } = harness(store)
  registry.restore('/project')
  const id = registry.detach(main.webContents, '/project', ['b'])
  registry.observeWorkspace('/old')
  assert.equal(opened.get(id)!.destroyed, true)
  assert.equal(opened.has('w-old'), true)
  assert.deepEqual(registry.list().map((entry) => [entry.id, entry.tabIds]), [['main', []], ['w-old', ['x']]])
  assert.deepEqual(store.list().map((record) => record.id).sort(), [id, 'w-old'].sort())
})

test('revealing a tab another window holds raises that window', () => {
  const { registry, main, opened } = harness()
  const id = registry.detach(main.webContents, '/project', ['b'])
  const detached = opened.get(id)!
  assert.equal(registry.revealTab(main.webContents, 'b'), true)
  assert.equal(detached.shown, 1)
  assert.deepEqual(detached.commands(), [{ type: 'activateTab', tabId: 'b' }])
  assert.equal(registry.revealTab(main.webContents, 'a'), false)
})

test('returning a tab gives it to the main window and drops it from the detached one', () => {
  const { registry, main, opened, store } = harness()
  const id = registry.detach(main.webContents, '/project', ['b', 'c'])
  registry.returnTabs(opened.get(id)!.webContents, ['c'])
  assert.deepEqual(main.commands(), [{ type: 'adoptTabs', tabIds: ['c'] }])
  assert.deepEqual(store.list(), [{ id, cwd: '/project', tabIds: ['b'] }])
})

test('an unknown sender has no window context', () => {
  const { registry } = harness()
  assert.throws(() => registry.context({ id: 9999 }), /not registered/)
})

test('a surface hears the chats it shows and workspace-wide events, never browser state', () => {
  const { registry, main } = harness()
  registry.claim('main', ['a', 'q'], ['a'])
  const sent: Sent[] = []
  let destroyed = false
  const surface = registry.attachSurface({ id: 9001, isDestroyed: () => destroyed, send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) } })
  surface.show(['q'])
  main.sent.length = 0
  registry.sendChatEvent(paneEvent('q'))
  registry.sendChatEvent(paneEvent('a'))
  registry.send('browser:tabs', [])
  registry.send('savedSites:changed', [])
  assert.deepEqual(sent.map((entry) => (entry.payload as { paneId?: string }).paneId ?? entry.channel), ['q', 'savedSites:changed'])
  assert.deepEqual(main.sent.map((entry) => (entry.payload as { paneId?: string }).paneId ?? entry.channel), ['q', 'a', 'browser:tabs', 'savedSites:changed'])
  assert.equal(registry.list().length, 1)
  destroyed = true
  registry.sendChatEvent(paneEvent('q'))
  surface.detach()
  assert.equal(sent.length, 2)
})

