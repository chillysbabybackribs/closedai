import type { JSX } from 'react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { Layout, LayoutChangedMeta, PanelSize, PanelImperativeHandle } from 'react-resizable-panels'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '../components/ui/resizable.js'
import {
  CHAT_PANE_MIN_PX,
  WORKSPACE_PANE_MIN_PX,
  defaultChatPaneWidth,
  persistChatPaneWidth,
  readChatPaneWidth
} from './workspace-split-state.js'

export function WorkspaceSplit({
  chat,
  workspace,
  browserVisible = true,
  chatMinimumWidth = CHAT_PANE_MIN_PX
}: {
  chat: ReactNode
  workspace: ReactNode
  browserVisible?: boolean
  chatMinimumWidth?: number
}): JSX.Element {
  const [defaultChatWidth] = useState(
    () => Math.max(readChatPaneWidth(window.localStorage) ?? defaultChatPaneWidth(window.innerWidth), chatMinimumWidth)
  )
  const latestChatWidth = useRef(defaultChatWidth)
  const browserPanel = useRef<PanelImperativeHandle>(null)
  const chatPanel = useRef<PanelImperativeHandle>(null)
  const previousMinimum = useRef(chatMinimumWidth)
  const previousVisible = useRef(browserVisible)
  const browserWidth = useRef<number | null>(null)
  useEffect(() => {
    if (!browserVisible) browserPanel.current?.collapse()
    else if (!previousVisible.current) browserPanel.current?.resize(browserWidth.current ?? '40%')
    previousVisible.current = browserVisible
  }, [browserVisible])
  useEffect(() => {
    if (chatMinimumWidth > previousMinimum.current && browserVisible) {
      chatPanel.current?.resize(Math.max(latestChatWidth.current, chatMinimumWidth))
    }
    previousMinimum.current = chatMinimumWidth
  }, [chatMinimumWidth, browserVisible])

  const rememberChatWidth = useCallback((size: PanelSize): void => {
    latestChatWidth.current = size.inPixels
  }, [])

  const persistSettledLayout = useCallback((_layout: Layout, meta: LayoutChangedMeta): void => {
    if (meta.isUserInteraction && browserVisible) {
      persistChatPaneWidth(window.localStorage, latestChatWidth.current)
    }
  }, [browserVisible])

  return (
    <ResizablePanelGroup
      id="workspace-primary-split"
      className="workspace-primary-split"
      orientation="horizontal"
      resizeTargetMinimumSize={{ coarse: 28, fine: 10 }}
      onLayoutChanged={persistSettledLayout}
    >
      <ResizablePanel
        id="chat"
        panelRef={chatPanel}
        className="workspace-chat-panel"
        defaultSize={defaultChatWidth}
        minSize={CHAT_PANE_MIN_PX}
        groupResizeBehavior="preserve-pixel-size"
        onResize={rememberChatWidth}
        style={{ overflow: 'hidden' }}
      >
        {chat}
      </ResizablePanel>
      <ResizableHandle
        id="chat-workspace-divider"
        data-ui="layout.browser-divider"
        disabled={!browserVisible}
        style={browserVisible ? undefined : { display: 'none' }}
        className="workspace-primary-divider"
        aria-label="Resize chat and workspace"
        title="Drag to resize · Double-click to reset"
        withHandle
      />
      <ResizablePanel
        id="workspace"
        panelRef={browserPanel}
        collapsible={!browserVisible}
        collapsedSize={0}
        defaultSize={browserVisible ? undefined : 0}
        disabled={!browserVisible}
        onResize={(size) => { if (browserVisible && size.inPixels > 0) browserWidth.current = size.inPixels }}
        className="workspace-context-panel"
        minSize={WORKSPACE_PANE_MIN_PX}
        style={{ overflow: 'hidden' }}
      >
        {workspace}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
