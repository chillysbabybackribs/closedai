import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatCanvas } from './chat-canvas.tsx'
import type { ChatLayout } from './layout-tree.ts'

const multiPaneTree: ChatLayout = {
  kind: 'split',
  id: 'split-1',
  axis: 'horizontal',
  ratio: 0.5,
  first: { kind: 'pane', id: 'pane-a' },
  second: { kind: 'pane', id: 'pane-b' }
}

const singlePaneTree: ChatLayout = {
  kind: 'pane',
  id: 'pane-single'
}

test('ChatCanvas renders multi-pane split with context menu trigger and dividers', () => {
  const html = renderToStaticMarkup(createElement(ChatCanvas, {
    tree: multiPaneTree,
    selectedId: 'pane-a',
    busy: false,
    browserVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {},
    onToggleBrowser: () => {},
    title: (id) => `Chat ${id}`,
    renderPane: (id) => createElement('div', { id: `content-${id}` }, `Content ${id}`),
    onSelect: () => {},
    onSelectTab: () => {},
    onCloseTab: () => {},
    onNewChat: () => {},
    onDock: () => {},
    onHide: () => {},
    onResize: () => {}
  }))

  // Both panes rendered as tiles
  assert.match(html, /data-pane-id="pane-a"/)
  assert.match(html, /data-pane-id="pane-b"/)
  // Drag handles rendered with layout options tooltip
  assert.match(html, /data-ui="layout\.pane-drag" data-ui-key="pane-a"/)
  assert.match(html, /data-ui="layout\.pane-drag" data-ui-key="pane-b"/)
  assert.match(html, /right-click for layout options/)
  // Context menu trigger wrapped around header
  assert.match(html, /class="chat-layout-header" data-state="closed"/)
  // Divider rendered in split mode
  assert.match(html, /data-ui="layout\.divider" data-ui-key="split-1"/)
  // Pane hide buttons are enabled when multiple panes exist
  assert.match(html, /data-ui="layout\.pane-hide" data-ui-key="pane-a"/)
  assert.doesNotMatch(html, /data-ui="layout\.pane-hide" data-ui-key="pane-a"[^>]*disabled/)
})

test('ChatCanvas renders single pane with disabled pane-hide and no dividers', () => {
  const html = renderToStaticMarkup(createElement(ChatCanvas, {
    tree: singlePaneTree,
    selectedId: 'pane-single',
    busy: false,
    browserVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {},
    onToggleBrowser: () => {},
    title: (id) => `Chat ${id}`,
    renderPane: (id) => createElement('div', { id: `content-${id}` }, `Content ${id}`),
    onSelect: () => {},
    onSelectTab: () => {},
    onCloseTab: () => {},
    onNewChat: () => {},
    onDock: () => {},
    onHide: () => {},
    onResize: () => {}
  }))

  assert.match(html, /data-pane-id="pane-single"/)
  // Context menu trigger installed on header
  assert.match(html, /class="chat-layout-header" data-state="closed"/)
  // In single chat mode without browser, hide button is disabled
  assert.match(html, /data-ui="layout\.pane-hide" data-ui-key="pane-single"[^>]*disabled/)
  // No dividers in single pane
  assert.doesNotMatch(html, /data-ui="layout\.divider"/)
})
