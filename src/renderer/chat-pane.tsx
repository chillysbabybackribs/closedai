import type { JSX } from 'react'
import { memo, useRef, useState } from 'react'

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '../components/ui/message-scroller.js'
import { CHAT_RESUME_PROMPT } from '../shared/chat.js'
import type { ChatAttachment } from '../shared/chat.js'
import { ConnectionBanner, EmptyState, useProviderAvailability } from './chat-connection.js'
import { useChatController, type ChatController } from './chat-controller.js'
import { ChatHistory } from './chat-history.js'
import { chatRunning } from './chat-state.js'
import { ChatTranscript } from './chat-transcript.js'
import { Composer } from './composer.js'
import { injectComposerDraft } from './composer-drafts.js'
import { CredentialApprovalCards } from './credential-approval-card.js'
import { errorMessage } from './error-message.js'
import type { ComposerSetupHandle } from './composer-setup-menu.js'
import { securityRequests } from './security-requests.js'
import { ToolsModal } from './tools/tools-modal.js'
import { TraceModal } from './trace/trace-modal.js'
import { useCredentialApprovals } from './use-security-requests.js'

/** Pane-scoped dialogs the shell's Agent and Developer menus can open on the selected chat pane. */
export type ChatPaneDialog = 'tools' | 'trace'

export const ChatPane = memo(function ChatPane({
  controller,
  zoom = 100,
  fontSize = 14,
  composerFontSize = 15,
  historyOpen: controlledHistoryOpen,
  onHistoryOpenChange,
  dialog: controlledDialog,
  onDialogChange,
  selected = true,
  onNewChat: _onNewChat,
  onContinueInNewChat,
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
  /** Opens a sibling tab with a digest-seeded chat (layout placement); message actions use this for full continue. */
  onContinueInNewChat?: () => Promise<void>
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
  const running = chatRunning(state)
  const [ownHistoryOpen, setOwnHistoryOpen] = useState(false)
  const historyOpen = controlledHistoryOpen ?? ownHistoryOpen
  const setHistoryOpen = onHistoryOpenChange ?? setOwnHistoryOpen
  const [ownDialog, setOwnDialog] = useState<ChatPaneDialog | null>(null)
  const dialog = controlledDialog === undefined ? ownDialog : controlledDialog
  const setDialog = onDialogChange ?? setOwnDialog
  const hasMessages = state.items.length > 0
  // 'starting' is the step on the way to ready, not a failure. Treating it as one made every new
  // chat flash the connection guidance and drop the composer to the bottom for the frames before
  // the pane's provider came up, so only a settled failure replaces the centered empty layout.
  const connecting = state.connection.state === 'starting'
  const blocked = !ready && !connecting
  const availability = useProviderAvailability(blocked && !hasMessages)
  // The composer is usable while the provider comes up: the picker lists the cached catalog, a
  // pick is a settings write, and a send waits for the provider itself. Locking it out until the
  // process was ready made every launch and every provider switch a pause the user could feel.
  const usable = ready || connecting
  // A continuation stays visually empty until its first message delivers the handoff to the model.
  const centerComposer = !blocked && !hasMessages && !historyOpen
  const modelMenuRef = useRef<ComposerSetupHandle>(null)
  const openModelMenu = (): void => modelMenuRef.current?.open()
  // What the pane itself could not do, shown above the composer until the next attempt.
  const [notice, setNotice] = useState('')
  const canCompact = manualCompact && ready && !running && state.items.some((item) => item.type === 'user')
  // Credential approvals (Settings → Security, off by default): this agent's requests, plus in the
  // selected pane any request without an open pane. Empty until the user turns the option on.
  const openPaneIds = chat.chats.filter((row) => row.attached).map((row) => row.paneId)
  const approvals = useCredentialApprovals(chat.selectedPaneId, selected, openPaneIds)

  function decideCredential(id: string, decision: 'allow' | 'deny'): void {
    setNotice('')
    securityRequests().credentials.resolve(id, decision)
      .catch((error: unknown) => setNotice(errorMessage(error, 'Could not answer the credential request')))
  }

  async function compactConversation(): Promise<void> {
    setNotice('')
    try {
      await chat.compactConversation()
    } catch (error) {
      setNotice(errorMessage(error, 'Could not compact the conversation'))
    }
  }

  async function sendMessage(text: string, attachments: ChatAttachment[]): Promise<void> {
    setHistoryOpen(false)
    await chat.send(text, attachments)
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
        <ToolsModal open={dialog === 'tools'} onOpenChange={(open) => setDialog(open ? 'tools' : null)}
          onSendToChat={(text) => { injectComposerDraft(chat.selectedPaneId, text); setDialog(null) }} />
        <TraceModal open={dialog === 'trace'} onOpenChange={(open) => setDialog(open ? 'trace' : null)} paneId={chat.selectedPaneId} />
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
              <EmptyState provider={state.provider} state={state.connection.state} message={state.connection.message} availability={availability}
                onLogin={chat.loginWithChatGPT} onChooseModel={openModelMenu} />
            ) : hasMessages ? (
              <ChatTranscript items={state.items} activeTurnId={state.activeTurnId}
                hasEarlier={state.history?.hasEarlier} loadEarlier={chat.loadEarlier}
                onTrimMountedHistory={chat.trimMountedHistory} actions={{
                threadKey: state.threadId ?? chat.selectedPaneId,
                running,
                branch: (itemId) => chat.continueFromChat({
                  paneId: chat.selectedPaneId, threadId: state.threadId, throughItemId: itemId
                }, state.selectedModel),
                continueInNewChat: onContinueInNewChat
              }} />
            ) : (
              <div aria-hidden="true" />
            )}
          </TranscriptScroller>
        )}
        {hasMessages && blocked && !historyOpen && (
          <ConnectionBanner provider={state.provider} state={state.connection.state} message={state.connection.message}
            onLogin={chat.loginWithChatGPT} onChooseModel={openModelMenu} />
        )}
        <CredentialApprovalCards requests={approvals} onDecide={decideCredential} />
        {notice && (
          <div className="chat-pane-notice" role="alert">
            <span>{notice}</span>
            <button type="button" className="chat-connection-link" data-ui="chat.notice-dismiss" onClick={() => setNotice('')}>Dismiss</button>
          </div>
        )}
        <Composer
          paneId={chat.selectedPaneId}
          setupMenuRef={modelMenuRef}
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
          cwd={project.cwd}
          projectPath={project.projectPath}
          projectPending={Boolean(record?.pendingProject)}
          recentProjects={recentProjects}
          onChooseProject={() => window.closedai.chat.chooseProject(chat.selectedPaneId)}
          onSelectProject={(projectPath) => window.closedai.chat.selectProject(chat.selectedPaneId, projectPath)}
          onClearProject={() => window.closedai.chat.clearProject(chat.selectedPaneId)}
          onCompactConversation={manualCompact ? compactConversation : undefined}
          compactConversationEnabled={canCompact}
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
