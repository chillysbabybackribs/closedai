import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Boxes, Compass, FlaskConical, Gem, RefreshCw, Sparkles } from 'lucide-react'

import type { ChatModel, ChatProvider } from '../../shared/chat.js'
import { Composer } from '../composer.js'
import { injectComposerDraft } from '../composer-drafts.js'

const ROOT_PANE_ID = 'preview-project-root'

const MODELS: ChatModel[] = [
  {
    id: 'gpt-5.6',
    provider: 'codex',
    displayName: 'GPT-5.6',
    description: 'OpenAI through Codex',
    contextWindow: 400_000,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep reasoning' }],
    isDefault: true
  },
  {
    id: 'claude-fable-5-1',
    provider: 'claude',
    displayName: 'Claude Fable 5.1',
    description: 'Anthropic through Claude Code',
    contextWindow: 200_000,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep reasoning' }],
    isDefault: false
  },
  {
    id: 'cursor-composer',
    provider: 'cursor',
    displayName: 'Composer',
    description: 'Cursor coding model',
    contextWindow: 200_000,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
    isDefault: false
  },
  {
    id: 'antigravity-gemini',
    provider: 'antigravity',
    displayName: 'Gemini',
    description: 'Google through Antigravity',
    contextWindow: 200_000,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep reasoning' }],
    isDefault: false
  }
]

const SUGGESTIONS = [
  {
    title: 'Build a new product',
    detail: 'Start with an idea and let the application take shape through working iterations.',
    prompt: 'I want to build a new product. Help me turn the rough idea into a working application that we can keep shaping as it develops.',
    icon: Sparkles
  },
  {
    title: 'Evolve this codebase',
    detail: 'Understand what exists, then improve it without freezing the destination too early.',
    prompt: 'I want to evolve this existing codebase. First understand how it works, then begin improving it while keeping the direction open to what we learn.',
    icon: RefreshCw
  },
  {
    title: 'Research and prototype',
    detail: 'Investigate the space, test promising directions, and build something concrete.',
    prompt: 'Research this product space and build a working prototype. Use what we discover to continuously refine the direction.',
    icon: FlaskConical
  },
  {
    title: 'Modernize a system',
    detail: 'Repair, simplify, and migrate an application while preserving useful behavior.',
    prompt: 'Help me modernize this system. Preserve what is valuable, find the real constraints, and improve it in safe working increments.',
    icon: Boxes
  }
] as const

type Message = { id: number; role: 'user' | 'coordinator'; text: string }

function coordinatorReply(message: string, first: boolean): string {
  if (!first) {
    return 'I’ve added that to the starting direction. The project can keep revising its structure and priorities as the working application gives us better information.'
  }
  const summary = message.replace(/\s+/g, ' ').trim()
  const clipped = summary.length > 210 ? `${summary.slice(0, 207)}…` : summary
  return `I understand the starting direction as: ${clipped}\n\nI’ll treat this as a goal to build toward, not a frozen specification. The first useful move is to establish a runnable foundation, explore the primary workflow, and let what we learn shape the next work.`
}

export function ProjectShellPreview() {
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedModel, setSelectedModel] = useState(MODELS[0]!.id)
  const [handoffNotice, setHandoffNotice] = useState(false)
  const [sending, setSending] = useState(false)
  const nextMessageId = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLElement>(null)
  const selected = MODELS.find((model) => model.id === selectedModel) ?? MODELS[0]!
  const provider = selected.provider as ChatProvider
  const hasConversation = messages.length > 0
  const canStart = messages.some((message) => message.role === 'coordinator') && !sending

  const providerSummary = useMemo(() => '4 providers available to the coordinator', [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  function chooseSuggestion(prompt: string): void {
    injectComposerDraft(ROOT_PANE_ID, prompt)
    requestAnimationFrame(() => shellRef.current?.querySelector<HTMLTextAreaElement>('[data-ui="composer.input"]')?.focus())
  }

  async function send(text: string): Promise<void> {
    const clean = text.trim()
    if (!clean) return
    const user: Message = { id: nextMessageId.current++, role: 'user', text: clean }
    setMessages((current) => [...current, user])
    setSending(true)
    await new Promise((resolve) => window.setTimeout(resolve, 420))
    setMessages((current) => [...current, {
      id: nextMessageId.current++,
      role: 'coordinator',
      text: coordinatorReply(clean, !current.some((message) => message.role === 'coordinator'))
    }])
    setSending(false)
  }

  return <div className="project-preview-app">
    <header className="project-preview-appbar" aria-label="ClosedAI preview chrome">
      <div className="project-preview-brand"><Gem size={16} aria-hidden="true" /> ClosedAI</div>
      <nav aria-label="Application menus"><span>File</span><span>View</span><span>Agent</span><span>Developer</span></nav>
      <div className="project-preview-search">Search chats <kbd>Ctrl H</kbd></div>
      <div className="project-preview-window-controls" aria-hidden="true"><span>—</span><span>□</span><span>×</span></div>
    </header>

    <main className="project-preview-workspace">
      <section className="project-shell" ref={shellRef} data-preview-project-shell aria-label="New project">
        <header className="project-shell-header">
          <span className="project-shell-grip" aria-hidden="true">⠿</span>
          <span className="project-shell-mark"><Compass size={15} aria-hidden="true" /></span>
          <strong>New project</strong>
          <span className="project-shell-kind">Project shell</span>
        </header>

        <div className={`project-shell-body${hasConversation ? ' has-conversation' : ''}`} ref={scrollRef}>
          {!hasConversation && <>
            <div className="project-shell-intro">
              <span className="project-shell-intro-mark"><Compass size={21} aria-hidden="true" /></span>
              <h1>What should we build?</h1>
              <p>Start rough. You can steer the project as it grows.</p>
            </div>
            <div className="project-suggestion-grid" aria-label="Starting suggestions">
              {SUGGESTIONS.map(({ title, detail, prompt, icon: Icon }) =>
                <button key={title} type="button" className="project-suggestion-card"
                  data-ui="preview.project-suggestion" data-ui-key={title}
                  onClick={() => chooseSuggestion(prompt)}>
                  <span className="project-suggestion-icon"><Icon size={16} aria-hidden="true" /></span>
                  <span><strong>{title}</strong><small>{detail}</small></span>
                </button>)}
            </div>
          </>}

          {hasConversation && <div className="project-conversation">
            {messages.map((message) => <article key={message.id} className={`project-message is-${message.role}`}>
              <div className="project-message-author">
                {message.role === 'user' ? 'You' : <><Compass size={13} aria-hidden="true" /> Root coordinator</>}
              </div>
              {message.text.split('\n').map((line, index) => line
                ? <p key={`${message.id}-${index}`}>{line}</p>
                : <span key={`${message.id}-${index}`} className="project-message-break" />)}
            </article>)}
            {sending && <div className="project-coordinator-thinking" role="status">
              <span /><span /><span /> Understanding the direction
            </div>}
            {canStart && <div className="project-start-row">
              <div><strong>Ready when you are</strong><span>Continue refining, or begin the project from this direction.</span></div>
              <button type="button" data-ui="preview.project-start" onClick={() => setHandoffNotice(true)}>
                Start building
              </button>
            </div>}
            {handoffNotice && <p className="project-handoff-notice" role="status">
              This preview intentionally ends at the handoff. The running project view will be designed separately.
            </p>}
          </div>}
        </div>

        <footer className="project-shell-footer">
          {!hasConversation && <p className="project-shell-help">
            Describe what you want to exist and anything you already care about. It does not need to be complete.
          </p>}
          <div className="composer project-shell-composer">
            <Composer
              enabled={!sending}
              running={false}
              placeholder="Describe what you want to create…"
              models={MODELS}
              selectedModel={selectedModel}
              selectedReasoningEffort={selected.defaultReasoningEffort}
              contextUsage={null}
              provider={provider}
              planUsage={null}
              onRefreshPlanUsage={async () => {}}
              onModelChange={async (modelId) => setSelectedModel(modelId)}
              onReasoningEffortChange={async () => {}}
              onSend={async (text) => send(text)}
              onStop={async () => {}}
              paused={false}
              onResume={async () => {}}
              onInspectContext={() => {}}
              cwd="/preview/closedai"
              projectPath="/preview/closedai"
              recentProjects={[]}
              onChooseProject={async () => {}}
              onSelectProject={async () => {}}
              onClearProject={async () => {}}
              activeTurnId={null}
              paneId={ROOT_PANE_ID}
            />
          </div>
          <span className="project-provider-note"><AppWindow size={12} aria-hidden="true" /> {providerSummary}</span>
        </footer>
      </section>
    </main>
  </div>
}
