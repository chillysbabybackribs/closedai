import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { FileCode2, LogIn } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '../components/ui/message-scroller.js'
import type { ChatAttachment, ChatConnectionState } from '../shared/chat.js'
import { useChatController } from './chat-controller.js'
import { ChatHeader } from './chat-header.js'
import { ChatHistory } from './chat-history.js'
import { chatTitle } from './chat-state.js'
import { ChatTranscript } from './chat-transcript.js'
import { Composer } from './composer.js'
import { ToolsModal } from './tools/tools-modal.js'

export function ChatPane(): JSX.Element {
  const chat = useChatController()
  const { state } = chat
  const ready = state.connection.state === 'ready'
  const running = state.activeTurnId !== null
  const [historyOpen, setHistoryOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const title = chatTitle(state)

  async function sendMessage(text: string, attachments: ChatAttachment[]): Promise<void> {
    setHistoryOpen(false)
    await chat.send(text, attachments)
  }

  async function startNewChat(): Promise<void> {
    setHistoryOpen(false)
    try {
      await chat.newThread()
    } catch {
      // The main process posts a transcript notice with the reason.
    }
  }

  async function continueInNewChat(): Promise<void> {
    setHistoryOpen(false)
    try {
      await chat.continueInNewThread()
    } catch {
      // As above: the reason lands in the transcript.
    }
  }

  return (
    <aside className="chat-pane prompt-chat" data-ui-surface="chat">
      <ChatHeader
        title={title}
        ready={ready}
        running={running}
        historyOpen={historyOpen}
        contextUsage={state.contextUsage}
        canContinue={state.items.some((item) => item.type === 'user')}
        onNewChat={() => void startNewChat()}
        onContinueInNewChat={() => void continueInNewChat()}
        onToggleHistory={() => setHistoryOpen((open) => !open)}
        onOpenTools={() => setToolsOpen(true)}
      />
      <ToolsModal open={toolsOpen} onOpenChange={setToolsOpen} />
      {historyOpen ? (
        <ChatHistory
          activeThreadId={state.threadId}
          busy={running}
          listThreads={chat.listThreads}
          openThread={chat.openThread}
          archiveThread={chat.archiveThread}
          onClose={() => setHistoryOpen(false)}
        />
      ) : (
        <TranscriptScroller threadId={state.threadId}>
          {state.items.length === 0
            ? <EmptyState state={state.connection.state} message={state.connection.message} onLogin={chat.loginWithChatGPT} />
            : <ChatTranscript items={state.items} />}
        </TranscriptScroller>
      )}
      <Composer
        enabled={ready}
        running={running}
        models={state.models}
        selectedModel={state.selectedModel}
        selectedReasoningEffort={state.selectedReasoningEffort}
        onModelChange={chat.selectModel}
        onReasoningEffortChange={chat.selectReasoningEffort}
        onSend={sendMessage}
        onStop={chat.interrupt}
      />
    </aside>
  )
}

function TranscriptScroller({
  threadId,
  children
}: {
  threadId: string | null
  children: JSX.Element
}): JSX.Element {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const scrollDir = useScrollDirection(root)

  return (
    <MessageScrollerProvider key={threadId ?? 'empty'} autoScroll defaultScrollPosition="end">
      <MessageScroller ref={setRoot} className="chat-scroll-root prompt-chat-scroll" data-scroll-dir={scrollDir}>
        <MessageScrollerViewport className="chat-scroll">
          <MessageScrollerContent className="chat-scroll-content gap-0">
            {children}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="start" />
        <MessageScrollerButton direction="end" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function useScrollDirection(root: HTMLElement | null): 'up' | 'down' {
  const [direction, setDirection] = useState<'up' | 'down'>('down')

  useEffect(() => {
    if (!root) return
    const viewport = root.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')
    if (!viewport) return
    let last = viewport.scrollTop
    const onScroll = (): void => {
      const next = viewport.scrollTop
      if (next === last) return
      setDirection(next > last ? 'down' : 'up')
      last = next
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [root])

  return direction
}

function EmptyState({
  state,
  message,
  onLogin
}: {
  state: ChatConnectionState
  message: string
  onLogin: () => Promise<void>
}): JSX.Element {
  const available = state === 'ready'
  return (
    <div className="prompt-chat-empty chat-empty">
      <div className="prompt-chat-empty-icon" aria-hidden="true"><FileCode2 /></div>
      <h2>{available ? 'How can I help you?' : 'Start with Codex'}</h2>
      <p>{available ? 'Ask a question or describe a change you want to make.' : message}</p>
      {state === 'signed-out' && (
        <Button type="button" variant="secondary" onClick={() => void onLogin()}>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in with ChatGPT
        </Button>
      )}
    </div>
  )
}
