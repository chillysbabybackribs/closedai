import { Monitor, PanelRightClose } from 'lucide-react'
import { useState, type Dispatch } from 'react'
import { BrowserPane } from '../browser-pane.js'
import { useBrowserController } from '../browser-controller.js'
import { ChatPane } from '../chat-pane.js'
import { usePaneChatController, type useChatController } from '../chat-controller.js'
import { initialChatState, type ChatWorkspaceAction } from '../chat-state.js'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { WorkspaceSplit } from '../workspace-split.js'
import { ChatCanvas } from './chat-canvas.js'
import { useChatLayout } from './layout-controller.js'
import { paneIds } from './layout-tree.js'

export function DesktopWorkspace({ chat, appearance, historyOpen, onHistoryOpenChange }: {
  chat: ReturnType<typeof useChatController>
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
}) {
  const layout = useChatLayout(chat.snapshot)
  const browser = useBrowserController(`browser:${layout.browserVisible}`, layout.browserVisible)
  const ids = paneIds(layout.tree)
  const [actionError, setActionError] = useState('')
  const select = (id: string): void => {
    void chat.selectPane(id).catch((reason: unknown) => setActionError(String(reason)))
  }
  return <div className="chat-desktop-workspace">
    <div className="chat-layout-toolbar">
      <span>{ids.length} {ids.length === 1 ? 'chat' : 'chats'}</span>
      <select data-ui="layout.add-chat" aria-label="Add an existing chat beside the focused pane" value="" disabled={layout.busy}
        onChange={(event) => { if (event.target.value) void layout.dock(event.target.value, chat.selectedPaneId, 'right') }}>
        <option value="">Add existing chat…</option>
        {chat.chats.filter((row) => !ids.includes(row.paneId)).map((row) =>
          <option key={row.paneId} value={row.paneId}>{row.title}</option>)}
      </select>
      <button data-ui="layout.browser-toggle" aria-pressed={layout.browserVisible} onClick={layout.toggleBrowser}
        title={layout.browserVisible ? 'Hide browser' : 'Show browser'}>
        {layout.browserVisible ? <PanelRightClose size={14} /> : <Monitor size={14} />}
        {layout.browserVisible ? 'Hide browser' : 'Show browser'}
      </button>
    </div>
    {(layout.error || actionError) && <div className="chat-layout-error" role="alert">{layout.error || actionError}</div>}
    <WorkspaceSplit browserVisible={layout.browserVisible} chatCount={ids.length}
      chat={<ChatCanvas tree={layout.tree} selectedId={chat.selectedPaneId} busy={layout.busy}
        title={(id) => chat.chats.find((row) => row.paneId === id)?.title ?? 'New chat'}
        onSelect={select} onDock={(id, target, edge) => { void layout.dock(id, target, edge) }}
        onHide={(id) => { void layout.hide(id) }} onResize={layout.resize}
        renderPane={(id) => <WorkspaceChat paneId={id} snapshot={chat.snapshot} dispatch={chat.dispatch}
          appearance={appearance} historyOpen={historyOpen && chat.selectedPaneId === id}
          onHistoryOpenChange={onHistoryOpenChange} />}
      />}
      workspace={<div className="workspace-right" data-mode="browser" data-with-browser={layout.browserVisible ? 'yes' : 'no'}>
        <div className={`workspace-surface workspace-surface-browser${layout.browserVisible ? '' : ' is-collapsed'}`}>
          <BrowserPane controller={browser} />
        </div>
      </div>}
    />
  </div>
}

function WorkspaceChat({ paneId, snapshot, dispatch, appearance, historyOpen, onHistoryOpenChange }: {
  paneId: string
  snapshot: ChatWorkspaceSnapshot
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
}) {
  const state = snapshot.panes?.[paneId] ?? (snapshot.selectedPaneId === paneId ? snapshot.selected : initialChatState())
  const controller = usePaneChatController(snapshot, paneId, state, dispatch)
  return <ChatPane controller={controller} zoom={appearance.chatZoom} fontSize={appearance.chatFontSize}
    composerFontSize={appearance.composerFontSize} historyOpen={historyOpen} onHistoryOpenChange={onHistoryOpenChange} />
}
