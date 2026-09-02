import type { JSX } from 'react'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import type { Layout, LayoutChangedMeta, PanelSize } from 'react-resizable-panels'
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
  workspace
}: {
  chat: ReactNode
  workspace: ReactNode
}): JSX.Element {
  const [defaultChatWidth] = useState(
    () => readChatPaneWidth(window.localStorage) ?? defaultChatPaneWidth(window.innerWidth)
  )
  const latestChatWidth = useRef(defaultChatWidth)

  const rememberChatWidth = useCallback((size: PanelSize): void => {
    latestChatWidth.current = size.inPixels
  }, [])

  const persistSettledLayout = useCallback((_layout: Layout, meta: LayoutChangedMeta): void => {
    if (meta.isUserInteraction) {
      persistChatPaneWidth(window.localStorage, latestChatWidth.current)
    }
  }, [])

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
        className="workspace-primary-divider"
        aria-label="Resize chat and workspace"
        title="Drag to resize · Double-click to reset"
        withHandle
      />
      <ResizablePanel
        id="workspace"
        className="workspace-context-panel"
        minSize={WORKSPACE_PANE_MIN_PX}
        style={{ overflow: 'hidden' }}
      >
        {workspace}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
