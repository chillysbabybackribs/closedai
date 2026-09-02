import assert from 'node:assert/strict'
import test from 'node:test'
import { overlayIsOpen } from './titlebar-browser-freeze.js'

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
