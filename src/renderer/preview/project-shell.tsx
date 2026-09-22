import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Compass, Gem } from 'lucide-react'

import type { ChatModel, ChatProvider } from '../../shared/chat.js'
import { Composer } from '../composer.js'
import { injectComposerDraft } from '../composer-drafts.js'
import { ProjectCanvas } from './project-canvas.js'
import { advanceDiscovery, clip, createDiscovery, isDirectionReady, type DiscoveryState } from './project-discovery.js'
import { ProjectIntake, type Message } from './project-intake.js'
import { ProjectSide, type FeedLine } from './project-side.js'
import { amendTree, applyEvent, buildDispatchPlan, layoutTree, rootNode, type TreeNode } from './project-tree.js'

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

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

export function ProjectShellPreview() {
  const [messages, setMessages] = useState<Message[]>([])
  const [discovery, setDiscovery] = useState<DiscoveryState>(createDiscovery)
  const [selectedModel, setSelectedModel] = useState(MODELS[0]!.id)
  const [phase, setPhase] = useState<'intake' | 'canvas'>('intake')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [feed, setFeed] = useState<FeedLine[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const nextId = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLElement>(null)

  const selectedModelEntry = MODELS.find((model) => model.id === selectedModel) ?? MODELS[0]!
  const provider = selectedModelEntry.provider as ChatProvider
  const record = discovery.record
  const ready = discovery.asking === null && isDirectionReady(record)
  const layout = useMemo(() => layoutTree(tree), [tree])
  const selectedNode = tree.find((node) => node.id === selectedId) ?? null

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  // Once building starts, the simulated root coordinator dispatches work on a timeline. The
  // record is fixed after Start, so the plan is derived once per build.
  useEffect(() => {
    if (phase !== 'canvas') return
    const timers: number[] = []
    let at = 0
    for (const event of buildDispatchPlan(record)) {
      at += event.delay
      timers.push(window.setTimeout(() => {
        setTree((current) => applyEvent(current, event))
        setFeed((current) => [...current, { id: nextId.current++, text: event.note }])
      }, at))
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [phase, record])

  function chooseSuggestion(prompt: string): void {
    injectComposerDraft(ROOT_PANE_ID, prompt)
    requestAnimationFrame(() => shellRef.current?.querySelector<HTMLTextAreaElement>('[data-ui="composer.input"]')?.focus())
  }

  function start(): void {
    setTree([rootNode(record)])
    setFeed([{ id: nextId.current++, text: 'Direction confirmed. Working from the record; only the next useful moves are planned.' }])
    setSelectedId(null)
    setPhase('canvas')
  }

  async function send(text: string): Promise<void> {
    const clean = text.trim()
    if (!clean) return
    setSending(true)
    if (phase === 'canvas') {
      await wait(260)
      const { note } = amendTree(tree, clean, selectedId)
      setTree((current) => amendTree(current, clean, selectedId).nodes)
      setFeed((current) => [...current, { id: nextId.current++, text: note }])
      setSending(false)
      return
    }
    setMessages((current) => [...current, { id: nextId.current++, role: 'user', text: clean }])
    const { state, reply } = advanceDiscovery(discovery, clean)
    await wait(420)
    setDiscovery(state)
    setMessages((current) => [...current, { id: nextId.current++, role: 'coordinator', text: reply }])
    setSending(false)
  }

  const canvasNote = selectedNode
    ? `Direction applies to “${selectedNode.title}”`
    : 'Direction applies to the whole project unless a node is selected'

  return <div className="project-preview-app">
    <header className="project-preview-appbar" aria-label="ClosedAI preview chrome">
      <div className="project-preview-brand"><Gem size={16} aria-hidden="true" /> ClosedAI</div>
      <nav aria-label="Application menus"><span>File</span><span>View</span><span>Agent</span><span>Developer</span></nav>
      <div className="project-preview-search">Search chats <kbd>Ctrl H</kbd></div>
      <div className="project-preview-window-controls" aria-hidden="true"><span>—</span><span>□</span><span>×</span></div>
    </header>

    <main className="project-preview-workspace">
      <section className="project-shell" ref={shellRef} data-preview-project-shell aria-label="Project">
        <header className="project-shell-header">
          <span className="project-shell-grip" aria-hidden="true">⠿</span>
          <span className="project-shell-mark"><Compass size={15} aria-hidden="true" /></span>
          <strong>{phase === 'canvas' ? clip(record.idea, 56) : 'New project'}</strong>
          <span className="project-shell-kind">{phase === 'canvas' ? 'Building' : 'Project shell'}</span>
        </header>

        {phase === 'canvas'
          ? <div className="project-workstation">
            <div className="project-tree-pane">
              <ProjectCanvas layout={layout} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
            <ProjectSide selected={selectedNode} feed={feed} />
          </div>
          : <div className={`project-shell-body${messages.length ? ' has-conversation' : ''}`} ref={scrollRef}>
            <ProjectIntake messages={messages} sending={sending} record={record} ready={ready}
              onSuggestion={chooseSuggestion} onStart={start} />
          </div>}

        <footer className="project-shell-footer">
          {phase === 'intake' && !messages.length && <p className="project-shell-help">
            Describe what you want to exist and anything you already care about. The coordinator asks for the rest.
          </p>}
          <div className="composer project-shell-composer">
            <Composer
              enabled={!sending}
              running={false}
              placeholder={phase === 'canvas'
                ? (selectedNode ? `Add direction to “${selectedNode.title}”…` : 'Add direction, a constraint, or a question…')
                : 'Describe what you want to create…'}
              models={MODELS}
              selectedModel={selectedModel}
              selectedReasoningEffort={selectedModelEntry.defaultReasoningEffort}
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
          <span className="project-provider-note"><AppWindow size={12} aria-hidden="true" />
            {phase === 'canvas' ? canvasNote : '4 providers available to the coordinator'}
          </span>
        </footer>
      </section>
    </main>
  </div>
}
