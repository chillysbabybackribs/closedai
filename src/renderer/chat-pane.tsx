import type { JSX } from 'react'
import { useState } from 'react'
import { FileCode2, LogIn } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from '../components/ui/chat-container.js'
import { TextShimmer } from '../components/ui/text-shimmer.js'
import type { ChatAttachment, ChatConnectionState } from '../shared/chat.js'
import { useChatController } from './chat-controller.js'
import { ChatHeader } from './chat-header.js'
import { ChatHistory } from './chat-history.js'
import { chatTitle } from './chat-state.js'
import { ChatTranscript, hasReasoningForTurn } from './chat-transcript.js'
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
  const showWorking = state.activeTurnId !== null && !hasReasoningForTurn(state.items, state.activeTurnId)

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

  return (
    <aside className="chat-pane prompt-chat" data-ui-surface="chat">
      <ChatHeader
        title={title}
        ready={ready}
        running={running}
        historyOpen={historyOpen}
        onNewChat={() => void startNewChat()}
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
      <ChatContainerRoot className="prompt-chat-scroll">
        <ChatContainerContent className="prompt-chat-content">
          {state.items.length === 0
            ? <EmptyState state={state.connection.state} message={state.connection.message} onLogin={chat.loginWithChatGPT} />
            : <ChatTranscript items={state.items} activeTurnId={state.activeTurnId} />}
          {showWorking && <WorkingIndicator />}
          <ChatContainerScrollAnchor />
        </ChatContainerContent>
      </ChatContainerRoot>
      )}
      <Composer
        enabled={ready}
        running={running}
        models={state.models}
        selectedModel={state.selectedModel}
        onModelChange={chat.selectModel}
        onSend={sendMessage}
        onStop={chat.interrupt}
      />
    </aside>
  )
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
    <div className="prompt-chat-empty">
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

function WorkingIndicator(): JSX.Element {
  return (
    <div className="prompt-working" aria-live="polite">
      <TextShimmer className="prompt-working-text">Thinking</TextShimmer>
    </div>
  )
}

