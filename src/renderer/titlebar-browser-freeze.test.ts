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
    constructor(readonly left: number, readonly width: number, readonly attributes: Record<string, string> = {}) {}
    hasAttribute(name: string) { return Object.hasOwn(this.attributes, name) }
    getAttribute(name: string) { return this.attributes[name] ?? null }
    closest() { return null }
    getBoundingClientRect() {
      return { left: this.left, right: this.left + this.width, top: 0, bottom: 800, width: this.width, height: 800 }
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
  } finally {
    if (originalElement) Object.defineProperty(globalThis, 'Element', originalElement)
    else Reflect.deleteProperty(globalThis, 'Element')
  }
})
