import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { separateChatCards } from './chat-cards.ts'
import { ChatCanvas } from './chat-canvas.tsx'
import type { ChatLayout } from './layout-tree.ts'

const windows = { change: () => {}, group: () => {}, raise: () => {}, minimize: () => {}, keepOnTop: () => {} }
const backdropProps = { backdrop: 'off' as const, onBackdropChange: () => {}, onOpenWallpaper: () => {}, maximized: [null, () => {}] as [string | null, () => void], onFitVisibleWindows: () => {}, chatZoom: 100, onChatZoomChange: () => {} }

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
    title: (id) => `Chat ${id}`,
    renderPane: (id, _visible) => createElement('div', { id: `content-${id}` }, `Content ${id}`),
    onSelect: () => {},
    onSelectTab: () => {},
    onCloseTab: () => {},
    onNewChat: () => {},
    onDock: () => {},
    onHide: () => {},
    onResize: () => {},
    windows,
    ...backdropProps
  }))

  // Both panes rendered as tiles
  assert.match(html, /data-pane-id="pane-a"/)
  assert.match(html, /data-pane-id="pane-b"/)
  assert.doesNotMatch(html, /data-ui="layout\.pane-drag"/, "chat cards drag from empty header space")
  assert.doesNotMatch(html, /class="chat-layout-(header|drag)"[^>]*draggable="true"/, 'windows move with the pointer, not native drag')
  assert.match(html, /data-pane-id="pane-a" data-window="tiled"/)
  // Context menu trigger wraps the whole tile body (header + transcript)
  assert.match(html, /class="chat-layout-tile-body"[^>]*data-state="closed"/)
  // Divider rendered in split mode
  assert.match(html, /data-ui="layout\.divider" data-ui-key="split-1"/)
  // Pane hide buttons are enabled when multiple panes exist
  assert.match(html, /data-ui="layout\.pane-hide" data-ui-key="pane-a"/, 'dismiss is a header close button')
  assert.match(html, /data-ui="layout\.window-minimize"/)
  assert.doesNotMatch(html, /data-ui="layout\.pane-hide" data-ui-key="pane-a"[^>]*disabled/)
})

test('ChatCanvas renders a single card with a context menu and no dividers', () => {
  const html = renderToStaticMarkup(createElement(ChatCanvas, {
    tree: singlePaneTree,
    selectedId: 'pane-single',
    busy: false,
    browserVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {},
    title: (id) => `Chat ${id}`,
    renderPane: (id, _visible) => createElement('div', { id: `content-${id}` }, `Content ${id}`),
    onSelect: () => {},
    onSelectTab: () => {},
    onCloseTab: () => {},
    onNewChat: () => {},
    onDock: () => {},
    onHide: () => {},
    onResize: () => {},
    windows,
    ...backdropProps
  }))

  assert.match(html, /data-pane-id="pane-single"/)
  assert.match(html, /class="chat-layout-tile-body"[^>]*data-state="closed"/)
  // In single chat mode without browser, hide button is disabled
  assert.doesNotMatch(html, /data-ui="layout\.pane-hide" data-ui-key="pane-single"[^>]*disabled/)
  // No dividers in single pane
  assert.doesNotMatch(html, /data-ui="layout\.divider"/)
})

test('ChatCanvas renders restored chat groups as separate cards without tab controls', () => {
  const tabbedTree: ChatLayout = {
    kind: 'pane',
    id: 'tab-1',
    tabs: ['tab-1', 'tab-2']
  }
  const html = renderToStaticMarkup(createElement(ChatCanvas, {
    tree: separateChatCards(tabbedTree),
    selectedId: 'tab-1',
    busy: false,
    browserVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {},
    title: (id) => `Chat ${id}`,
    renderPane: (id, _visible) => createElement('div', { id: `content-${id}` }, `Content ${id}`),
    onSelect: () => {},
    onSelectTab: () => {},
    onCloseTab: () => {},
    onNewChat: () => {},
    onDock: () => {},
    onHide: () => {},
    onResize: () => {},
    windows,
    ...backdropProps
  }))

  assert.match(html, /data-pane-id="tab-1"/)
  assert.match(html, /data-pane-id="tab-2"/)
  assert.equal(html.match(/class="chat-layout-header chat-card-header"/g)?.length, 2)
  assert.doesNotMatch(html, /data-ui="layout\.tab"/)
  assert.doesNotMatch(html, /data-ui="layout\.(new-chat|card-continue)"/)
  assert.doesNotMatch(html, /chat-card-icon/)
  assert.doesNotMatch(html, /chat-card-model/)
  assert.doesNotMatch(html, /data-ui="layout\.card-more"/)
  assert.doesNotMatch(html, /data-ui="layout\.card-pin"/, 'the star needs a pin handler')
  assert.doesNotMatch(html, /id="chat-panel-tab-[12]"[^>]*hidden/)

})

test('ChatCanvas names running close/hide actions without a dismissal popup', () => {
  const tabbedTree: ChatLayout = {
    kind: 'pane',
    id: 'tab-1',
    tabs: ['tab-1', 'tab-2']
  }
  const html = renderToStaticMarkup(createElement(ChatCanvas, {
    tree: separateChatCards(tabbedTree),
    selectedId: 'tab-1',
    busy: false,
    browserVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {},
    title: (id) => `Chat ${id}`,
    activity: (id) => id === 'tab-2'
      ? { state: 'working', label: 'Working' }
      : { state: 'idle', label: 'Ready' },
    renderPane: (id, _visible) => createElement('div', { id: `content-${id}` }, `Content ${id}`),
    onSelect: () => {},
    onSelectTab: () => {},
    onCloseTab: () => {},
    onNewChat: () => {},
    onDock: () => {},
    onHide: () => {},
    onResize: () => {},
    windows,
    ...backdropProps
  }))

  assert.doesNotMatch(html, /data-ui="layout\.tab-close"/)
  assert.match(html, /data-ui="layout\.pane-hide" data-ui-key="tab-2"[^>]*title="Dismiss chat · Tasks keep running"/)
  assert.doesNotMatch(html, /chat-layout-notice|Chat dismissed|Window closed/)
})

test('ChatCanvas renders a view window with its kind glyph, no chat status, and no new-tab button', () => {
  const view = 'closedai:view:trace:v1'
  const tree: ChatLayout = { kind: 'pane', id: view, tabs: [view] }
  const html = renderToStaticMarkup(createElement(ChatCanvas, {
    tree,
    selectedId: 'chat-1',
    busy: false,
    browserVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {},
    title: (id) => id === view ? 'Trace' : `Chat ${id}`,
    activity: () => ({ state: 'working' as const, label: 'Working' }),
    renderPane: (id, _visible) => createElement('div', { id: `content-${id}` }, `Content ${id}`),
    onSelect: () => {},
    onSelectTab: () => {},
    onCloseTab: () => {},
    onNewChat: () => {},
    onDock: () => {},
    onHide: () => {},
    onResize: () => {},
    windows,
    ...backdropProps
  }))

  // The tile is named by its active view, so it carries no chat pane id for automation.
  assert.doesNotMatch(html, /data-pane-id=/)
  assert.match(html, new RegExp(`data-view-id="${view}"`))
  // The view tab has a kind and a glyph, never a chat status; a view window has nothing for + to add.
  assert.match(html, /class="chat-layout-tab" data-active="true" data-kind="trace"/)
  assert.doesNotMatch(html, /data-status=/)
  assert.doesNotMatch(html, /data-ui="layout\.new-chat"/)
  assert.doesNotMatch(html, /id="chat-panel-closedai:view:trace:v1"[^>]*hidden/)
})

test('ChatCanvas lifts a floating window above the tiles, with resize grips, and minimizes to hidden', () => {
  const tree: ChatLayout = { ...multiPaneTree, second: { kind: 'pane', id: 'pane-b', float: { x: 40, y: 30, width: 320, height: 300, z: 2 } } }
  const props = {
    selectedId: 'pane-a', busy: false, browserVisible: false,
    renderBrowser: createElement('div', { id: 'browser-content' }, 'Browser'),
    onDragActive: () => {}, title: (id: string) => `Chat ${id}`,
    renderPane: (id: string) => createElement('div', { id: `content-${id}` }, `Content ${id}`),
    onSelect: () => {}, onSelectTab: () => {}, onCloseTab: () => {}, onNewChat: () => {},
    onDock: () => {}, onHide: () => {}, onResize: () => {}, windows, ...backdropProps
  }
  const html = renderToStaticMarkup(createElement(ChatCanvas, { ...props, tree }))
  assert.match(html, /style="left:40px;top:30px;width:320px;height:300px;z-index:12" data-pane-id="pane-b" data-window="floating"/)
  assert.equal(html.match(/data-ui="layout\.window-resize"/g)?.length, 8)
  assert.doesNotMatch(html, /data-ui="layout\.divider"/, 'a floating window leaves no split')
  assert.match(html, /data-ui="layout\.window-minimize" data-ui-key="pane-b"/, 'floating chat cards keep window buttons')
  const minimized: ChatLayout = { ...multiPaneTree, second: { kind: 'pane', id: 'pane-b', docked: true, dockNumber: 1 } }
  const hidden = renderToStaticMarkup(createElement(ChatCanvas, { ...props, tree: minimized }))
  assert.match(hidden, /data-pane-id="pane-b" data-window="hidden"[^>]*hidden=""/)
  assert.doesNotMatch(hidden, /data-ui="layout\.window-minimize" data-ui-key="pane-a" disabled/, 'the last visible chat may minimize')
})
