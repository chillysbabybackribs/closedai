import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldHeaderDoubleClickFit, shouldShellTitlebarDoubleClickFit } from './header-double-click-fit.ts'

type Node = { tag: string; className?: string; parent?: Node }

function el(node: Node): HTMLElement {
  const element = {
    matches(selector: string): boolean {
      if (!selector.startsWith('.')) return false
      return node.className?.split(/\s+/).includes(selector.slice(1)) ?? false
    },
    closest(selector: string): Element | null {
      const selectors = selector.split(',').map((part) => part.trim())
      let current: Node | undefined = node
      while (current) {
        const hit = el(current)
        if (selectors.some((part) => hit.matches(part))) return hit
        current = current.parent
      }
      return null
    }
  } as unknown as HTMLElement
  return element
}

function chain(...nodes: Node[]): HTMLElement {
  for (let index = 1; index < nodes.length; index++) nodes[index]!.parent = nodes[index - 1]
  return el(nodes.at(-1)!)
}

test('shell title bar double-click fit targets the app header band, not menus or shell controls', () => {
  assert.equal(shouldShellTitlebarDoubleClickFit(chain(
    { tag: 'div', className: 'titlebar-fit-hit' }
  )), true)
  assert.equal(shouldShellTitlebarDoubleClickFit(chain(
    { tag: 'header', className: 'shell-titlebar' },
    { tag: 'div', className: 'titlebar-fit-hit' }
  )), true)
  assert.equal(shouldShellTitlebarDoubleClickFit(chain(
    { tag: 'div', className: 'titlebar-start' },
    { tag: 'button', className: 'titlebar-nav-tab' }
  )), false)
  assert.equal(shouldShellTitlebarDoubleClickFit(chain(
    { tag: 'div', className: 'shell-window-controls' },
    { tag: 'button', className: 'shell-window-control' }
  )), false)
})

test('header double-click fit skips window chrome, not the rest of the strip', () => {
  assert.equal(shouldHeaderDoubleClickFit(chain(
    { tag: 'div', className: 'chat-window-controls' },
    { tag: 'button' }
  )), false)
  assert.equal(shouldHeaderDoubleClickFit(chain(
    { tag: 'header', className: 'chat-layout-header' },
    { tag: 'div', className: 'header-chat-search-field' }
  )), true)
  assert.equal(shouldHeaderDoubleClickFit(chain(
    { tag: 'div', className: 'chat-layout-tabs' },
    { tag: 'button', className: 'chat-layout-tab' }
  )), true)
  assert.equal(shouldHeaderDoubleClickFit(chain(
    { tag: 'div', className: 'chat-layout-tab' },
    { tag: 'button', className: 'chat-layout-tab-close' }
  )), false)
})
