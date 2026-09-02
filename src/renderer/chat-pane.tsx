import type { JSX } from 'react'
import { useState } from 'react'
import { AlertTriangle, Check, Copy, FileCode2, LogIn } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from '../components/ui/chat-container.js'
import { Message, MessageAction, MessageActions, MessageContent } from '../components/ui/message.js'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '../components/ui/reasoning.js'
import { TextShimmer } from '../components/ui/text-shimmer.js'
import { Tool, type ToolPart } from '../components/ui/tool.js'
import type { ChatApproval, ChatAttachment, ChatConnectionState, ChatTranscriptItem } from '../shared/chat.js'
import { useChatController } from './chat-controller.js'
import { ChatHeader } from './chat-header.js'
import { ChatHistory } from './chat-history.js'
import { ChatScreenshot } from './chat-screenshot.js'
import { chatTitle } from './chat-state.js'
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
          {state.items.length === 0 && state.approvals.length === 0
            ? <EmptyState state={state.connection.state} message={state.connection.message} onLogin={chat.loginWithChatGPT} />
            : state.items.map((item) => (
                <TranscriptItem key={item.id} item={item} running={state.activeTurnId === item.turnId} />
              ))}
          {state.activeTurnId && <WorkingIndicator />}
          {state.approvals.map((approval) => (
            <ApprovalCard key={approval.requestId} approval={approval} respond={chat.respondToApproval} />
          ))}
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

function TranscriptItem({ item, running }: { item: ChatTranscriptItem; running: boolean }): JSX.Element | null {
  if (item.type === 'user') {
    return (
      <Message className="prompt-message prompt-message-user">
        <div className="prompt-message-user-stack">
          {item.attachments?.length ? (
            <div className="prompt-message-user-attachments">
              {item.attachments.map((attachment) => (
                <span key={attachment.id}>{attachment.kind === 'image' ? 'Image' : 'File'} · {attachment.name}</span>
              ))}
            </div>
          ) : null}
          {item.text && <MessageContent className="prompt-message-user-content">{item.text}</MessageContent>}
        </div>
      </Message>
    )
  }
  if (item.type === 'assistant') {
    if (!item.text) return null
    return <AssistantMessage item={item} />
  }
  if (item.type === 'notice') {
    return <div className="prompt-system-message" data-tone={item.tone} role={item.tone === 'error' ? 'alert' : 'status'}>{item.text}</div>
  }
  if (item.type === 'screenshot') return <ChatScreenshot item={item} />
  if (item.type === 'command') {
    return (
      <Tool
        className="prompt-transcript-tool"
        defaultOpen={item.status === 'inProgress'}
        toolPart={{
          type: item.command,
          state: toolState(item.status, item.exitCode),
          input: item.cwd ? { cwd: item.cwd } : undefined,
          output: item.output ? { output: item.output, exitCode: item.exitCode } : undefined,
          errorText: item.exitCode !== null && item.exitCode !== 0 ? `Command exited with code ${item.exitCode}` : undefined,
          toolCallId: item.id
        }}
      />
    )
  }
  if (item.type === 'fileChange') {
    return (
      <Tool
        className="prompt-transcript-tool"
        toolPart={{
          type: `${item.changes.length} file change${item.changes.length === 1 ? '' : 's'}`,
          state: toolState(item.status, null),
          input: { files: item.changes.map(({ path, kind }) => ({ path, kind })) },
          output: item.changes.some((change) => change.diff)
            ? { diffs: item.changes.filter((change) => change.diff).map(({ path, diff }) => ({ path, diff })) }
            : undefined,
          toolCallId: item.id
        }}
      />
    )
  }
  if (item.type === 'plan' || item.type === 'reasoning') {
    if (!item.text) return null
    return (
      <Reasoning className="prompt-reasoning" isStreaming={running}>
        <ReasoningTrigger className="prompt-reasoning-trigger">
          {item.type === 'plan' ? 'Plan' : running ? 'Thinking…' : 'Reasoning'}
        </ReasoningTrigger>
        <ReasoningContent markdown className="prompt-reasoning-content" contentClassName="prompt-reasoning-copy prose prose-sm max-w-none dark:prose-invert">
          {item.text}
        </ReasoningContent>
      </Reasoning>
    )
  }
  return (
    <Tool
      className="prompt-transcript-tool"
      defaultOpen={item.status === 'inProgress'}
      toolPart={{
        type: item.label,
        state: toolState(item.status, null),
        input: item.detail ? { detail: item.detail } : undefined,
        toolCallId: item.id
      }}
    />
  )
}

function AssistantMessage({ item }: { item: Extract<ChatTranscriptItem, { type: 'assistant' }> }): JSX.Element {
  const [copied, setCopied] = useState(false)
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Message className="prompt-message prompt-message-assistant" data-phase={item.phase ?? 'unknown'}>
      <div className="prompt-message-assistant-stack">
        <MessageContent
          markdown
          className="prompt-message-assistant-content prose max-w-none prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base prose-h5:text-sm prose-h6:text-xs dark:prose-invert"
        >
          {item.text}
        </MessageContent>
        {!item.streaming && (
          <MessageActions className="prompt-message-actions">
            <MessageAction tooltip={copied ? 'Copied' : 'Copy response'}>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Copy response" onClick={() => void copy()}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </Button>
            </MessageAction>
          </MessageActions>
        )}
      </div>
    </Message>
  )
}

function WorkingIndicator(): JSX.Element {
  return (
    <div className="prompt-working" aria-live="polite">
      <TextShimmer className="prompt-working-text">Thinking</TextShimmer>
    </div>
  )
}

function ApprovalCard({
  approval,
  respond
}: {
  approval: ChatApproval
  respond: (requestId: string, decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel') => Promise<void>
}): JSX.Element {
  return (
    <section className="prompt-approval" aria-label={approval.title}>
      <div className="prompt-approval-heading">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <strong>{approval.title}</strong>
      </div>
      <code>{approval.detail}</code>
      {approval.reason && <p>{approval.reason}</p>}
      <div className="prompt-approval-actions">
        <Button type="button" variant="ghost" size="sm" onClick={() => void respond(approval.requestId, 'decline')}>Decline</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => void respond(approval.requestId, 'acceptForSession')}>Always allow</Button>
        <Button type="button" size="sm" onClick={() => void respond(approval.requestId, 'accept')}>Allow once</Button>
      </div>
    </section>
  )
}

function toolState(status: string, exitCode: number | null): ToolPart['state'] {
  const normalized = status.toLowerCase()
  if (normalized.includes('progress') || normalized.includes('running')) return 'input-streaming'
  if (normalized.includes('fail') || normalized.includes('error') || (exitCode !== null && exitCode !== 0)) return 'output-error'
  if (normalized.includes('pending') || normalized.includes('request')) return 'input-available'
  return 'output-available'
}
