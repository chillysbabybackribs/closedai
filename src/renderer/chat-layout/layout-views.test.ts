import assert from 'node:assert/strict'
import test from 'node:test'
import { chatPaneIds, dockPane, isViewTabId, paneIds, readLayout, saveLayout, type ChatLayout } from './layout-tree.ts'
import { addTab, chatTabIds, moveTab, pruneTabs, removeTab, selectTab, tabIds } from './layout-tabs.ts'
import { oneKindPerTile, openTabInTree, parseViewTab, pinOnMove, pruneViewScopes, sameTabKind, viewOfKind, viewScope, viewTabId } from './layout-views.ts'

const trace = viewTabId('trace', 'v1')
const tools = viewTabId('tools', 'v2')

test('view ids carry their kind and stay out of the chat lists', () => {
  assert.ok(isViewTabId(trace))
  assert.deepEqual(parseViewTab(trace), { id: trace, kind: 'trace' })
  assert.equal(parseViewTab('closedai:view:unknown:x'), null)
  assert.equal(parseViewTab('chat-1'), null)
  let tree: ChatLayout = addTab({ kind: 'pane', id: 'a' }, 'a', trace)
  tree = dockPane(tree, 'b', trace, 'right', 'split')
  assert.deepEqual(tabIds(tree), ['a', trace, 'b'])
  assert.deepEqual(chatTabIds(tree), ['a', 'b'])
  assert.deepEqual(paneIds(tree), [trace, 'b'])
  assert.deepEqual(chatPaneIds(tree), ['b'])
  // Pruning against main's chats never drops a view, and a view can be the last tab in its tile.
  assert.deepEqual(tabIds(pruneTabs(tree, new Set(['b']))), [trace, 'b'])
  assert.equal(viewOfKind(tree, 'trace'), trace)
  assert.equal(viewOfKind(tree, 'tools'), null)
})

test('a window only takes tabs of its own kind', () => {
  assert.ok(!sameTabKind('a', 'b'), 'chat cards cannot join a tab strip')
  assert.ok(sameTabKind(trace, viewTabId('trace', 'other')))
  assert.ok(!sameTabKind(trace, 'a'), 'a view never joins a chat strip')
  assert.ok(!sameTabKind('a', tools), 'a chat never joins a view strip')
  assert.ok(!sameTabKind(trace, tools))
  assert.ok(!sameTabKind('closedai:view:agents:x', 'closedai:view:agents:y'), 'a retired kind joins nothing')
})

test('a view opens in a window of its kind, else a new window, never beside chats', () => {
  const chats: ChatLayout = { kind: 'pane', id: 'a', tabs: ['a', 'b'] }
  const opened = openTabInTree(chats, tools, 'a', 'split-1')
  assert.deepEqual(chatTabIds(opened), ['a', 'b'])
  assert.deepEqual(paneIds(opened), ['a', tools], 'Tools fronts a window of its own')
  const fileA = viewTabId('file', 'a.ts')
  const fileB = viewTabId('file', 'b.ts')
  let files = openTabInTree(chats, fileA, 'a', 'split-2')
  files = openTabInTree(files, fileB, 'a', 'split-3')
  assert.equal(paneIds(files).length, 2, 'the second file joins the first file window')
  assert.ok(paneIds(files).includes(fileB))
  // A chat not yet open skips a view window it is anchored to and joins the chat window.
  const chat = openTabInTree(files, 'c', fileB, 'split-4')
  assert.deepEqual(paneIds(chat).sort(), ['a', 'c', fileB].sort())
})

test('saved layouts that mixed kinds keep their chats and drop the strays', () => {
  const mixed: ChatLayout = dockPane({ kind: 'pane', id: trace, tabs: ['a', trace, 'closedai:view:agents:x'] }, tools, trace, 'right', 'split')
  const cleaned = oneKindPerTile(mixed)
  assert.deepEqual(tabIds(cleaned), ['a', tools])
  assert.deepEqual(paneIds(cleaned), ['a', tools])
})

test('a view follows its own tile, then the workspace selection, unless pinned', () => {
  let tree: ChatLayout = addTab(addTab({ kind: 'pane', id: 'a' }, 'a', 'c'), 'c', trace)
  tree = dockPane(tree, 'b', trace, 'right', 'split')
  // Tile [a, c, trace] with trace active: the selected chat wins when it lives here.
  assert.deepEqual(viewScope(tree, trace, undefined, 'c'), { chatId: 'c', mode: 'following' })
  assert.deepEqual(viewScope(tree, trace, undefined, 'a'), { chatId: 'a', mode: 'following' })
  // Selected elsewhere: the tile's first chat.
  assert.deepEqual(viewScope(tree, trace, undefined, 'b'), { chatId: 'a', mode: 'following' })
  // A lone view tile follows the selection.
  const lone = dockPane({ kind: 'pane', id: 'a' }, tools, 'a', 'bottom', 'split')
  assert.deepEqual(viewScope(lone, tools, undefined, 'a'), { chatId: 'a', mode: 'following' })
  // Pinned wins while the chat is open, and falls back to following once it is gone.
  const scopes = { [trace]: { pinnedChatId: 'b' } }
  assert.deepEqual(viewScope(tree, trace, scopes, 'a'), { chatId: 'b', mode: 'pinned' })
  const withoutB = removeTab(tree, 'b')!
  assert.deepEqual(viewScope(withoutB, trace, scopes, 'a'), { chatId: 'a', mode: 'following' })
  assert.equal(pruneViewScopes(scopes, withoutB), undefined)
  assert.equal(pruneViewScopes(scopes, tree), scopes)
})

test('moving a following view out of its tile pins it to the chat it showed', () => {
  let tree: ChatLayout = addTab({ kind: 'pane', id: 'a' }, 'a', trace)
  tree = dockPane(tree, 'b', trace, 'right', 'split')
  // Same tile: no pin. Another tile or a fresh split: pinned to a.
  assert.equal(pinOnMove(tree, trace, trace, undefined, 'b'), undefined)
  assert.deepEqual(pinOnMove(tree, trace, 'b', undefined, 'b'), { [trace]: { pinnedChatId: 'a' } })
  assert.deepEqual(pinOnMove(tree, trace, null, undefined, 'b'), { [trace]: { pinnedChatId: 'a' } })
  const pinned = { [trace]: { pinnedChatId: 'b' } }
  assert.equal(pinOnMove(tree, trace, 'b', pinned, 'a'), pinned)
  assert.equal(pinOnMove(tree, 'a', 'b', undefined, 'a'), undefined)
  // The move itself is an ordinary tab move; the source tile keeps its chat.
  const moved = moveTab(tree, trace, 'b', null, 'unused')
  assert.deepEqual(paneIds(moved), ['a', trace])
  assert.deepEqual(chatPaneIds(moved), ['a'])
})

test('saved layouts keep view tabs and only well-formed pins', () => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
  let tree: ChatLayout = addTab({ kind: 'pane', id: 'a' }, 'a', trace)
  tree = selectTab(dockPane(tree, 'b', trace, 'right', 'split'), 'b', 'b')
  const views = { [trace]: { pinnedChatId: 'b' } }
  saveLayout(storage, '/p', { tree, browserVisible: true, views })
  assert.deepEqual(readLayout(storage, '/p'), { tree, browserVisible: true, views })
  // Pins to closed chats, to other views, or for absent views are dropped without losing the tree.
  saveLayout(storage, '/q', { tree, browserVisible: true,
    views: { [trace]: { pinnedChatId: 'zzz' }, [tools]: { pinnedChatId: 'a' }, a: { pinnedChatId: 'b' } } })
  assert.deepEqual(readLayout(storage, '/q'), { tree, browserVisible: true })
})
