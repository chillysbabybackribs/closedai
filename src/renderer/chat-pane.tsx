import { BackgroundTaskIndicator, currentBackgroundTasks } from './background-tasks.js'
import type { JSX } from 'react'
import { memo, useState } from 'react'
import { LogIn } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '../components/ui/message-scroller.js'
import { CHAT_RESUME_PROMPT } from '../shared/chat.js'
import type { ChatAttachment, ChatConnectionState, ChatProvider } from '../shared/chat.js'
import { useChatController, type ChatController } from './chat-controller.js'
import { ChatHistory } from './chat-history.js'
import { PROVIDER_LABELS } from './chat-state.js'
import { ChatTranscript } from './chat-transcript.js'
import { Composer } from './composer.js'
import { ContextInspectorModal } from './context-inspector-modal.js'
import { TaskActivity } from './task-activity.js'
import { ToolsModal } from './tools/tools-modal.js'
import { TraceModal } from './trace/trace-modal.js'

export const ChatPane = memo(function ChatPane({
  controller,
  zoom = 100,
  fontSize = 14,
  composerFontSize = 15,
  historyOpen: controlledHistoryOpen,
  onHistoryOpenChange
}: {
  controller?: ChatController
  zoom?: number
  fontSize?: number
  composerFontSize?: number
  /** Supplied by the shell so the title bar menu and Ctrl+H reach this panel. */
  historyOpen?: boolean
  onHistoryOpenChange?: (open: boolean) => void
} = {}): JSX.Element {
  const internalChat = useChatController(!controller)
  const chat = controller ?? internalChat
  const { state, preferences } = chat
  const manualCompact = state.provider === 'antigravity' && preferences?.chatSeamlessRotation !== true
  const backgroundItems = state.history?.backgroundTasks?.length
    ? [...state.history.backgroundTasks, ...state.items] : state.items
  const ready = state.connection.state === 'ready'
  const running = state.activeTurnId !== null
  const [ownHistoryOpen, setOwnHistoryOpen] = useState(false)
  const historyOpen = controlledHistoryOpen ?? ownHistoryOpen
  const setHistoryOpen = onHistoryOpenChange ?? setOwnHistoryOpen
  const [toolsOpen, setToolsOpen] = useState(false)
  const [traceOpen, setTraceOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const hasMessages = state.items.length > 0
  // 'starting' is the step on the way to ready, not a failure. Treating it as one made every new
  // chat flash the connection guidance and drop the composer to the bottom for the frames before
  // the pane's provider came up, so only a settled failure replaces the centered empty layout.
  const connecting = state.connection.state === 'starting'
  const blocked = !ready && !connecting
  // The composer is usable while the provider comes up: the picker lists the cached catalog, a
  // pick is a settings write, and a send waits for the provider itself. Locking it out until the
  // process was ready made every launch and every provider switch a pause the user could feel.
  const usable = ready || connecting
  const centerComposer = !blocked && !hasMessages && !historyOpen

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
    <aside
      className={`chat-pane prompt-chat${centerComposer ? ' prompt-chat-composer-centered' : ''}`}
      data-ui-surface="chat"
      data-zoom={zoom}
    >
      <div
        className="chat-zoom-surface"
        style={{
          '--chat-zoom': zoom / 100,
          '--chat-zoom-inverse': 100 / zoom,
          '--chat-font-size': `${fontSize}px`,
          '--chat-fs-body': `${fontSize}px`,
          '--chat-fs-markdown': `${fontSize}px`,
          '--composer-font-size': `${composerFontSize}px`
        } as React.CSSProperties}
      >
        <ToolsModal open={toolsOpen} onOpenChange={setToolsOpen} />
        <TraceModal open={traceOpen} onOpenChange={setTraceOpen} paneId={chat.selectedPaneId} />
        <ContextInspectorModal
          open={contextOpen}
          onOpenChange={setContextOpen}
          report={state.turnContext}
          usage={state.contextUsage}
        />
        {historyOpen ? (
          <ChatHistory
            activeChatId={chat.selectedPaneId}
            busy={running}
            listChats={chat.listChats}
            openChat={chat.openChat}
            archiveChat={chat.archiveChat}
            onClose={() => setHistoryOpen(false)}
          />
        ) : (
          <TranscriptScroller threadId={state.threadId} paneId={chat.selectedPaneId}>
            {!hasMessages && blocked ? (
              <EmptyState provider={state.provider} state={state.connection.state} message={state.connection.message} onLogin={chat.loginWithChatGPT} />
            ) : hasMessages ? (
              <ChatTranscript items={state.items} activeTurnId={state.activeTurnId}
                hasEarlier={state.history?.hasEarlier} loadEarlier={chat.loadEarlier}
                onTrimMountedHistory={chat.trimMountedHistory} actions={{
                threadKey: state.threadId ?? chat.selectedPaneId,
                running,
                branch: (itemId) => chat.continueFromChat({
                  paneId: chat.selectedPaneId, threadId: state.threadId, throughItemId: itemId
                }, state.selectedModel)
              }} />
            ) : (
              <div aria-hidden="true" />
            )}
          </TranscriptScroller>
        )}
        <TaskActivity>
          {currentBackgroundTasks(backgroundItems).length ? (
            <BackgroundTaskIndicator key={state.items.filter((item) => item.type === 'user').at(-1)?.id ?? state.threadId} items={backgroundItems} />
          ) : null}
        </TaskActivity>
        <Composer
          enabled={usable}
          running={running}
          placeholder={connecting ? state.connection.message : undefined}
          models={state.models}
          selectedModel={state.selectedModel}
          selectedReasoningEffort={state.selectedReasoningEffort}
          contextUsage={state.contextUsage}
          provider={state.provider}
          planUsage={state.planUsage}
          onRefreshPlanUsage={chat.refreshPlanUsage}
          onModelChange={chat.selectModel}
          onReasoningEffortChange={chat.selectReasoningEffort}
          onSend={sendMessage}
          onStop={chat.interrupt}
          paused={state.pausedTurnId !== null}
          onResume={() => sendMessage(CHAT_RESUME_PROMPT, [])}
          onInspectContext={() => setContextOpen(true)}
          onNewChat={() => void startNewChat()}
          cwd={chat.workspace?.cwd ?? state.cwd}
          projectPath={chat.workspace?.projectPath ?? state.cwd}
          recentProjects={chat.workspace?.recentProjects ?? []}
          onChooseProject={() => window.closedai.chat.chooseProject()}
          onSelectProject={(projectPath) => window.closedai.chat.selectProject(projectPath)}
          onClearProject={() => window.closedai.chat.clearProject()}
          onOpenTools={() => setToolsOpen(true)}
          onOpenTrace={() => setTraceOpen(true)}
          activeTurnId={state.activeTurnId}
          onCompactConversation={manualCompact ? chat.compactConversation : undefined}
          compactConversationEnabled={manualCompact && ready && !running && state.items.some((item) => item.type === 'user')}
        />
      </div>
    </aside>
  )
})


function TranscriptScroller({
  threadId,
  paneId,
  children
}: {
  threadId: string | null
  paneId: string
  children: JSX.Element
}): JSX.Element {
  return (
    <MessageScrollerProvider key={JSON.stringify([paneId, threadId])} autoScroll defaultScrollPosition="end">
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
        <Button type="button" variant="secondary" data-ui="chat.sign-in" onClick={() => void onLogin()}>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in with ChatGPT
        </Button>
      )}
    </div>
  )
}
