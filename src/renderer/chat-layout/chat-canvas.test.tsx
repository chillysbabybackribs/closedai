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
    agentVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {},
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
  assert.match(html, /class="chat-layout-drag"[^>]*data-ui="layout\.pane-drag" data-ui-key="pane-a"[^>]*draggable="true"/)
  assert.match(html, /class="chat-layout-drag"[^>]*data-ui="layout\.pane-drag" data-ui-key="pane-b"[^>]*draggable="true"/)
  assert.match(html, /right-click for layout options/)
  assert.doesNotMatch(html, /class="chat-layout-header"[^>]*draggable="true"/)
  // Context menu trigger wrapped around header
  assert.match(html, /class="chat-layout-header"[^>]*data-state="closed"/)
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
    agentVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {},
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
  assert.match(html, /class="chat-layout-header"[^>]*data-state="closed"/)
  // In single chat mode without browser, hide button is disabled
  assert.match(html, /data-ui="layout\.pane-hide" data-ui-key="pane-single"[^>]*disabled/)
  // No dividers in single pane
  assert.doesNotMatch(html, /data-ui="layout\.divider"/)
})

test('ChatCanvas renders tabbed pane with single tile, persistent header, and hidden inactive panel', () => {
  const tabbedTree: ChatLayout = {
    kind: 'pane',
    id: 'tab-1',
    tabs: ['tab-1', 'tab-2']
  }
  const html = renderToStaticMarkup(createElement(ChatCanvas, {
    tree: tabbedTree,
    selectedId: 'tab-1',
    busy: false,
    browserVisible: false,
    agentVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {},
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

  // Only one section tile rendered for the tabbed group
  const chatTileMatches = html.match(/data-pane-id="tab-1"/g)
  assert.equal(chatTileMatches?.length, 1)
  assert.doesNotMatch(html, /data-pane-id="tab-2"/)
  // Only one header rendered
  const headerMatches = html.match(/class="chat-layout-header"/g)
  assert.equal(headerMatches?.length, 1)
  // Both tab buttons rendered in the header
  assert.match(html, /data-ui="layout\.tab" data-ui-key="tab-1"/)
  assert.match(html, /data-ui="layout\.tab" data-ui-key="tab-2"/)
  assert.match(html, /class="chat-layout-drag"[^>]*data-ui="layout\.pane-drag" data-ui-key="tab-1"[^>]*draggable="true"/)
  assert.match(html, /Drag to move whole pane/)
  // Tab 1 is active, Tab 2 is inactive
  assert.match(html, /id="chat-tab-tab-1"[^>]*aria-selected="true"/)
  assert.match(html, /id="chat-tab-tab-2"[^>]*aria-selected="false"/)
  assert.match(html, /id="chat-tab-tab-1"[^>]*draggable="true"/)
  assert.match(html, /id="chat-tab-tab-2"[^>]*draggable="true"/)
  // Active panel is visible, inactive panel is hidden
  assert.match(html, /id="chat-panel-tab-1"[^>]*><div id="content-tab-1">Content tab-1/)
  assert.doesNotMatch(html, /id="chat-panel-tab-1"[^>]*hidden/)
  assert.match(html, /id="chat-panel-tab-2"[^>]*hidden/)
})

test('ChatCanvas names running close/hide actions and overlays a status notice', () => {
  const tabbedTree: ChatLayout = {
    kind: 'pane',
    id: 'tab-1',
    tabs: ['tab-1', 'tab-2']
  }
  const html = renderToStaticMarkup(createElement(ChatCanvas, {
    tree: tabbedTree,
    selectedId: 'tab-1',
    busy: false,
    notice: 'Tab closed · Tasks continue in the background',
    browserVisible: false,
    agentVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {},
    title: (id) => `Chat ${id}`,
    activity: (id) => id === 'tab-2'
      ? { state: 'working', label: 'Working' }
      : { state: 'idle', label: 'Ready' },
    renderPane: (id) => createElement('div', { id: `content-${id}` }, `Content ${id}`),
    onSelect: () => {},
    onSelectTab: () => {},
    onCloseTab: () => {},
    onNewChat: () => {},
    onDock: () => {},
    onHide: () => {},
    onResize: () => {}
  }))

  assert.match(html, /title="Close tab · Task keeps running"/)
  assert.match(html, /aria-label="Close tab: Chat tab-2 · Task keeps running"/)
  assert.match(html, /title="Close tab · Does not stop tasks"/)
  assert.match(html, /title="Hide pane · Tasks keep running"/)
  assert.match(html, /class="chat-layout-notice"[^>]*>Tab closed · Tasks continue in the background/)
})
