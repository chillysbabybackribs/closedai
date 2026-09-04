import { Monitor, PanelRightClose } from 'lucide-react'
import { useImperativeHandle, useState, type Dispatch, type Ref } from 'react'
import { createPortal } from 'react-dom'
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
import { minimumSize } from './layout-tree.js'

export type ChatLayoutHandle = {
  splitChat: (chatId: string, edge: 'right' | 'bottom') => Promise<void>
}

export function DesktopWorkspace({ chat, appearance, historyOpen, onHistoryOpenChange, browserToggleHost, ref }: {
  chat: ReturnType<typeof useChatController>
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
  browserToggleHost: HTMLDivElement | null
  ref?: Ref<ChatLayoutHandle>
}) {
  const layout = useChatLayout(chat.snapshot)
  useImperativeHandle(ref, () => ({
    splitChat: (chatId, edge) => layout.dock(chatId, chat.selectedPaneId, edge)
  }), [layout.dock, chat.selectedPaneId])
  const browser = useBrowserController(`browser:${layout.browserVisible}`, layout.browserVisible)
  const [actionError, setActionError] = useState('')
  const select = (id: string): void => {
    void chat.selectPane(id).catch((reason: unknown) => setActionError(String(reason)))
  }
  return <div className="chat-desktop-workspace">
    {browserToggleHost && createPortal(
      <button className="titlebar-icon-button" data-ui="layout.browser-toggle" aria-pressed={layout.browserVisible} onClick={layout.toggleBrowser}
        aria-label={layout.browserVisible ? 'Hide browser' : 'Show browser'}
        title={layout.browserVisible ? 'Hide browser' : 'Show browser'}>
        {layout.browserVisible ? <PanelRightClose size={14} /> : <Monitor size={14} />}
      </button>, browserToggleHost
    )}
    {(layout.error || actionError) && <div className="chat-layout-error" role="alert">{layout.error || actionError}</div>}
    <WorkspaceSplit browserVisible={layout.browserVisible} chatMinimumWidth={minimumSize(layout.tree).width}
      onBrowserHide={layout.toggleBrowser}
      chat={<ChatCanvas tree={layout.tree} selectedId={chat.selectedPaneId} busy={layout.busy}
        title={(id) => chat.chats.find((row) => row.paneId === id)?.title ?? 'New chat'}
        onSelect={select} onDock={(id, target, edge) => { void layout.dock(id, target, edge) }}
        onNewChat={(id) => { onHistoryOpenChange(false); void layout.newChat(id) }}
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
