import assert from 'node:assert/strict'
import test from 'node:test'
import { overlayBlocksBrowser, overlayIsOpen } from './titlebar-browser-freeze.js'

function overlay(attributes: Record<string, string> = {}, detailsOpen?: boolean): Element {
  return {
    hasAttribute: (name: string) => Object.hasOwn(attributes, name),
    getAttribute: (name: string) => attributes[name] ?? null,
    closest: (selector: string) => selector === 'details' && detailsOpen !== undefined
      ? { open: detailsOpen }
      : null
  } as unknown as Element
}

test('closed and accessibility-hidden overlay surfaces do not occlude the browser', () => {
  assert.equal(overlayIsOpen(overlay({ 'data-state': 'closed' })), false)
  assert.equal(overlayIsOpen(overlay({ 'aria-hidden': 'true' })), false)
  assert.equal(overlayIsOpen(overlay({ hidden: '' })), false)
})

test('open dialogs and menus in open details remain browser overlays', () => {
  assert.equal(overlayIsOpen(overlay({ 'data-state': 'open' })), true)
  assert.equal(overlayIsOpen(overlay({}, true)), true)
  assert.equal(overlayIsOpen(overlay({}, false)), false)
})

test('modal backdrop occludes the browser before an image dialog grows into it', () => {
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  class Surface {
    constructor(readonly left: number, readonly width: number, readonly attributes: Record<string, string> = {}, readonly top = 0, readonly height = 800) {}
    hasAttribute(name: string) { return Object.hasOwn(this.attributes, name) }
    getAttribute(name: string) { return this.attributes[name] ?? null }
    closest() { return null }
    getBoundingClientRect() {
      return { left: this.left, right: this.left + this.width, top: this.top, bottom: this.top + this.height, width: this.width, height: this.height }
    }
  }
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: Surface })
  try {
    const host = new Surface(900, 380)
    const dialog = new Surface(400, 400, { 'data-state': 'open' })
    const backdrop = new Surface(0, 1280, {
      'data-state': 'open', 'data-slot': 'dialog-overlay', 'aria-hidden': 'true'
    })
    const root = {
      querySelector: () => host,
      querySelectorAll: (selector: string) => selector.includes('[data-slot="dialog-overlay"]')
        ? [dialog, backdrop] : [dialog]
    } as unknown as ParentNode
    assert.equal(overlayBlocksBrowser(root), true)
    backdrop.attributes['data-state'] = 'closed'
    assert.equal(overlayBlocksBrowser(root), false)
    const search = new Surface(750, 440)
    const searchRoot = {
      querySelector: () => host,
      querySelectorAll: (selector: string) => selector.includes('.header-chat-search-popup') ? [search] : []
    } as unknown as ParentNode
    assert.equal(overlayBlocksBrowser(searchRoot), true, 'header suggestions freeze an overlapping native page')
    const viewMenu = new Surface(720, 460, { 'data-state': 'open' })
    const viewMenuRoot = {
      querySelector: () => host,
      querySelectorAll: (selector: string) => selector.includes('[role="menu"]') ? [viewMenu] : []
    } as unknown as ParentNode
    assert.equal(overlayBlocksBrowser(viewMenuRoot), true, 'View menu freezes an overlapping native page')
    const edgeMenu = new Surface(720, 460, { 'data-state': 'open' }, 0, 200)
    const edgeHost = new Surface(720, 460, {}, 200, 600)
    const edgeRoot = {
      querySelector: () => edgeHost,
      querySelectorAll: () => [edgeMenu]
    } as unknown as ParentNode
    assert.equal(overlayBlocksBrowser(edgeRoot), true, 'an overlay touching the native page edge is occluded')
    const clearRoot = {
      querySelector: () => host,
      querySelectorAll: () => [new Surface(100, 440)]
    } as unknown as ParentNode
    assert.equal(overlayBlocksBrowser(clearRoot), false, 'search outside browser bounds leaves the page live')
  } finally {
    if (originalElement) Object.defineProperty(globalThis, 'Element', originalElement)
    else Reflect.deleteProperty(globalThis, 'Element')
  }
})

test('resized browser previews coalesce captures and discard obsolete frames', async () => {
  const { createBrowserFreezeRefresh } = await import('./titlebar-browser-freeze.js')
  type Shot = import('../shared/types.js').BrowserShot
  const pending: Array<(shot: Shot | null) => void> = []
  const published: string[] = []
  const refresh = createBrowserFreezeRefresh(
    () => new Promise((resolve) => pending.push(resolve)),
    (shot) => published.push(shot.imageUrl)
  )
  const bounds = { x: 0, y: 0, width: 800, height: 600, visible: true, occluded: true }
  const frame = (imageUrl: string): Shot => ({ imageUrl, tabId: 'a', url: '', title: '' })
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
  refresh(bounds)
  refresh({ ...bounds, width: 400 })
  refresh({ ...bounds, width: 300 })
  assert.equal(pending.length, 1, 'bounds updates do not start parallel captures')
  pending.shift()!(frame('old'))
  await tick()
  assert.deepEqual(published, [])
  assert.equal(pending.length, 1, 'only the newest dimensions need another capture')
  pending.shift()!(frame('resized'))
  await tick()
  assert.deepEqual(published, ['resized'])
  refresh(bounds)
  refresh({ ...bounds, occluded: false })
  pending.shift()!(frame('after-release'))
  await tick()
  assert.deepEqual(published, ['resized'], 'release invalidates the in-flight capture')
  refresh(bounds)
  pending.shift()!(null)
  await tick()
  refresh(bounds)
  pending.shift()!(frame('recovered'))
  await tick()
  assert.deepEqual(published, ['resized', 'recovered'])
})

test('a covered page that was resized is captured once more after it lays out', async () => {
  const { createBrowserFreezeRefresh } = await import('./titlebar-browser-freeze.js')
  type Shot = import('../shared/types.js').BrowserShot
  const pending: Array<(shot: Shot | null) => void> = []
  const settles: Array<() => void> = []
  const published: string[] = []
  const refresh = createBrowserFreezeRefresh(
    () => new Promise((resolve) => pending.push(resolve)),
    (shot) => published.push(shot.imageUrl),
    (run) => settles.push(run)
  )
  const bounds = { x: 0, y: 0, width: 800, height: 600, visible: true, occluded: true }
  const frame = (imageUrl: string): Shot => ({ imageUrl, tabId: 'a', url: '', title: '' })
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
  refresh(bounds)
  pending.shift()!(frame('first'))
  await tick()
  assert.equal(settles.length, 1)
  settles.shift()!()
  assert.equal(pending.length, 1, 'the settled page is captured again')
  pending.shift()!(frame('laid-out'))
  await tick()
  assert.deepEqual(published, ['first', 'laid-out'])
  assert.equal(settles.length, 0, 'one settle capture per size, not a loop')
  refresh({ ...bounds, width: 500 })
  pending.shift()!(frame('smaller'))
  await tick()
  refresh({ ...bounds, occluded: false })
  settles.shift()!()
  assert.equal(pending.length, 0, 'a released page is not captured again')
})
