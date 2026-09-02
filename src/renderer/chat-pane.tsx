import type { JSX } from 'react'
import { useState } from 'react'
import { LogIn } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '../components/ui/message-scroller.js'
import type { ChatAttachment, ChatConnectionState, ChatProvider } from '../shared/chat.js'
import { useChatController } from './chat-controller.js'
import { ChatHeader } from './chat-header.js'
import { ChatHistory } from './chat-history.js'
import { chatTitle, PROVIDER_LABELS } from './chat-state.js'
import { ChatTranscript } from './chat-transcript.js'
import { Composer } from './composer.js'
import { ToolsModal } from './tools/tools-modal.js'

export function ChatPane({ controller }: { controller?: ReturnType<typeof useChatController> } = {}): JSX.Element {
  const internalChat = useChatController()
  const chat = controller ?? internalChat
  const { state } = chat
  const ready = state.connection.state === 'ready'
  const running = state.activeTurnId !== null
  const [historyOpen, setHistoryOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const title = chatTitle(state)
  const hasMessages = state.items.length > 0
  const centerComposer = ready && !hasMessages && !historyOpen

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
    <aside
      className={`chat-pane prompt-chat${centerComposer ? ' prompt-chat-composer-centered' : ''}`}
      data-ui-surface="chat"
    >
      <ChatHeader
        title={title}
        cwd={state.cwd}
        ready={ready}
        running={running}
        historyOpen={historyOpen}
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
          {!hasMessages && !ready ? (
            <EmptyState provider={state.provider} state={state.connection.state} message={state.connection.message} onLogin={chat.loginWithChatGPT} />
          ) : hasMessages ? (
            <ChatTranscript items={state.items} activeTurnId={state.activeTurnId} />
          ) : (
            <div aria-hidden="true" />
          )}
        </TranscriptScroller>
      )}
      <Composer
        enabled={ready}
        running={running}
        models={state.models}
        selectedModel={state.selectedModel}
        selectedReasoningEffort={state.selectedReasoningEffort}
        contextUsage={state.contextUsage}
        onModelChange={chat.selectModel}
        onReasoningEffortChange={chat.selectReasoningEffort}
        onSend={sendMessage}
        onStop={chat.interrupt}
        onNewChat={() => void startNewChat()}
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
  return (
    <MessageScrollerProvider key={threadId ?? 'empty'} autoScroll defaultScrollPosition="end">
      <MessageScroller className="chat-scroll-root prompt-chat-scroll">
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

function EmptyState({
  provider,
  state,
  message,
  onLogin
}: {
  provider: ChatProvider
  state: ChatConnectionState
  message: string
  onLogin: () => Promise<void>
}): JSX.Element {
  return (
    <div className="prompt-chat-empty chat-empty">
      <h2>{`Start with ${PROVIDER_LABELS[provider]}`}</h2>
      <p>{message}</p>
      {/* Claude Code signs in from its own CLI; the message above says how. */}
      {state === 'signed-out' && provider === 'codex' && (
        <Button type="button" variant="secondary" onClick={() => void onLogin()}>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in with ChatGPT
        </Button>
      )}
    </div>
  )
}
