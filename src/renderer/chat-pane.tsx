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
import { ToolsModal } from './tools/tools-modal.js'
import { TraceModal } from './trace/trace-modal.js'

/** Pane-scoped dialogs the shell's Agent and Developer menus can open on the selected pane. */
export type ChatPaneDialog = 'tools' | 'trace' | 'context'

export const ChatPane = memo(function ChatPane({
  controller,
  zoom = 100,
  fontSize = 14,
  composerFontSize = 15,
  historyOpen: controlledHistoryOpen,
  onHistoryOpenChange,
  dialog: controlledDialog,
  onDialogChange,
  onNewChat,
  archiveChat
}: {
  controller?: ChatController
  zoom?: number
  fontSize?: number
  composerFontSize?: number
  /** Supplied by the shell so the title bar menu and Ctrl+H reach this panel. */
  historyOpen?: boolean
  onHistoryOpenChange?: (open: boolean) => void
  /** The Agent and Developer menus open these on the selected pane. */
  dialog?: ChatPaneDialog | null
  onDialogChange?: (dialog: ChatPaneDialog | null) => void
  selected?: boolean
  onNewChat: () => void
  archiveChat?: (chatId: string) => Promise<void>
}): JSX.Element {
  const internalChat = useChatController(!controller)
  const chat = controller ?? internalChat
  const { state, preferences } = chat
  const record = chat.chats.find((row) => row.paneId === chat.selectedPaneId)
  const project = record?.pendingProject ?? { cwd: record?.cwd ?? state.cwd,
    projectPath: record?.projectPath === undefined ? state.cwd : record.projectPath }
  const recentProjects = [...new Map([
    ...(chat.workspace?.recentProjects ?? []),
    ...chat.chats.filter((row) => row.projectPath).map((row) => ({ cwd: row.cwd, projectPath: row.projectPath! }))
  ].map((entry) => [entry.projectPath, entry])).values()].filter((entry) => entry.projectPath !== project.projectPath)
  const manualCompact = state.provider === 'antigravity' && preferences?.chatSeamlessRotation !== true
  const ready = state.connection.state === 'ready'
  const running = state.activeTurnId !== null
  const [ownHistoryOpen, setOwnHistoryOpen] = useState(false)
  const historyOpen = controlledHistoryOpen ?? ownHistoryOpen
  const setHistoryOpen = onHistoryOpenChange ?? setOwnHistoryOpen
  const [ownDialog, setOwnDialog] = useState<ChatPaneDialog | null>(null)
  const dialog = controlledDialog === undefined ? ownDialog : controlledDialog
  const setDialog = onDialogChange ?? setOwnDialog
  const contextOpen = dialog === 'context'
  const setContextOpen = (open: boolean): void => setDialog(open ? 'context' : null)
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

  function startNewChat(): void {
    setHistoryOpen(false)
    onNewChat()
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
        <ToolsModal open={dialog === 'tools'} onOpenChange={(open) => setDialog(open ? 'tools' : null)} />
        <TraceModal open={dialog === 'trace'} onOpenChange={(open) => setDialog(open ? 'trace' : null)} paneId={chat.selectedPaneId} />
        <ContextInspectorModal
          open={contextOpen}
          onOpenChange={setContextOpen}
          report={state.turnContext}
          usage={state.contextUsage}
          checkpoint={state.checkpoint ?? null}
          onCompact={manualCompact ? () => { void chat.compactConversation(); setContextOpen(false); } : undefined}
          compactEnabled={manualCompact && ready && !running && state.items.some((item) => item.type === 'user')}
          onNewChat={() => { startNewChat(); setContextOpen(false); }}
        />
        {historyOpen ? (
          <ChatHistory
            activeChatId={chat.selectedPaneId}
            busy={running}
            listChats={chat.listChats}
            chats={chat.chats}
            openChat={chat.openChat}
            archiveChat={archiveChat ?? chat.archiveChat}
            onClose={() => setHistoryOpen(false)}
          />
        ) : (
          <TranscriptScroller paneId={chat.selectedPaneId}>
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
        <Composer
          paneId={chat.selectedPaneId}
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
          cwd={project.cwd}
          projectPath={project.projectPath}
          projectPending={Boolean(record?.pendingProject)}
          recentProjects={recentProjects}
          onChooseProject={() => window.closedai.chat.chooseProject(chat.selectedPaneId)}
          onSelectProject={(projectPath) => window.closedai.chat.selectProject(chat.selectedPaneId, projectPath)}
          onClearProject={() => window.closedai.chat.clearProject(chat.selectedPaneId)}
          activeTurnId={state.activeTurnId}
          onCompactConversation={manualCompact ? chat.compactConversation : undefined}
          compactConversationEnabled={manualCompact && ready && !running && state.items.some((item) => item.type === 'user')}
        />
      </div>
    </aside>
  )
})


function TranscriptScroller({
  paneId,
  children
}: {
  paneId: string
  children: JSX.Element
}): JSX.Element {
  // A sent prompt anchors at the viewport top and the response streams in below it, so the
  // beginning of a long answer never scrolls out of view mid-turn. Scrolling releases the anchor,
  // reaching the bottom resumes follow-to-bottom (autoScroll), and opening a chat still mounts at
  // the end. The peek keeps a sliver of the previous turn visible above the anchored prompt.
  return (
    <MessageScrollerProvider
      key={paneId}
      autoScroll
      anchorPrompts
      defaultScrollPosition="end"
      scrollPreviousItemPeek={12}
    >
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
