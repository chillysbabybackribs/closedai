import type { JSX } from 'react'

import type { ChatTranscriptItem } from '../../shared/chat.js'
import { ChatTranscript } from '../chat-transcript.js'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '../../components/ui/message-scroller.js'
export function AgentWorkspaceTranscript({
  paneId,
  items,
  activeTurnId,
  running
}: {
  paneId: string
  items: ChatTranscriptItem[]
  activeTurnId: string | null
  running: boolean
}): JSX.Element {
  return (
    <MessageScrollerProvider
      key={paneId}
      autoScroll
      anchorPrompts
      defaultScrollPosition="end"
      scrollPreviousItemPeek={12}
    >
      <MessageScroller className="chat-scroll-root prompt-chat-scroll agent-workspace-scroll">
        <MessageScrollerViewport className="chat-scroll">
          <MessageScrollerContent className="chat-scroll-content gap-0">
            <ChatTranscript items={items} activeTurnId={activeTurnId} actions={{
              threadKey: paneId,
              running,
              branch: async () => {}
            }} />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="start" />
        <MessageScrollerButton direction="end" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
