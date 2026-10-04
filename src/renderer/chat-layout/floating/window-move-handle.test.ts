import assert from 'node:assert/strict'
import test from 'node:test'
import { pressesMoveHandle, selectsWindow } from './window-move-handle.js'

type Node = {
  tag: string
  className?: string
  attrs?: Record<string, string>
  parent?: Node
}

function el(node: Node): HTMLElement {
  const element = {
    matches(selector: string): boolean {
      if (selector === '[data-window-grip]') return node.attrs?.['data-window-grip'] !== undefined
      if (selector.startsWith('.')) return node.className?.split(/\s+/).includes(selector.slice(1)) ?? false
      return false
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
    },
  } as unknown as HTMLElement
  return element
}

function chain(...nodes: Node[]): HTMLElement {
  for (let index = 1; index < nodes.length; index++) nodes[index]!.parent = nodes[index - 1]
  return el(nodes.at(-1)!)
}

test('pressesMoveHandle treats empty chat tab rail like a move handle', () => {
  const header = { tag: 'header', className: 'chat-layout-header' }
  const tabs = { tag: 'div', className: 'chat-layout-tabs', parent: header }
  const target = chain(header, tabs)
  assert.equal(pressesMoveHandle({ target }), true)
})

test('pressesMoveHandle ignores chat tab labels and header controls', () => {
  const header = { tag: 'header', className: 'chat-layout-header' }
  const tab = { tag: 'div', className: 'chat-layout-tab', parent: header }
  const tabButton = { tag: 'button', attrs: { role: 'tab' }, parent: tab }
  assert.equal(pressesMoveHandle({ target: chain(header, tab, tabButton) }), false)

  const newChat = { tag: 'button', className: 'chat-layout-new-chat', parent: header }
  assert.equal(pressesMoveHandle({ target: chain(header, newChat) }), false)
})

test('pressesMoveHandle keeps browser tab strip empty space draggable', () => {
  const strip = { tag: 'div', className: 'browser-tabstrip' }
  assert.equal(pressesMoveHandle({ target: chain(strip) }), true)

  const tab = { tag: 'div', className: 'browser-tab', parent: strip }
  const select = { tag: 'button', className: 'browser-tab-select', parent: tab }
  assert.equal(pressesMoveHandle({ target: chain(strip, tab, select) }), false)
})

test('pressesMoveHandle honors pane and browser grips', () => {
  const grip = { tag: 'button', attrs: { 'data-window-grip': '' } }
  assert.equal(pressesMoveHandle({ target: chain(grip) }), true)
})


test('window buttons and their icons do not select or start dragging the departing chat', () => {
  const header = { tag: 'header', className: 'chat-layout-header' }
  const controls = { tag: 'div', className: 'chat-window-controls' }
  for (const target of [chain(header, controls, { tag: 'button' }),
    chain(header, controls, { tag: 'button' }, { tag: 'svg' }, { tag: 'path' })]) {
    assert.equal(selectsWindow(target), false)
    assert.equal(pressesMoveHandle({ target }), false)
  }
  assert.equal(selectsWindow(chain(header)), true)
})
