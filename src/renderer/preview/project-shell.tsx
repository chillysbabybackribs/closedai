import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Compass, Gem, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import type { ChatModel, ChatProvider } from '../../shared/chat.js'
import { Composer } from '../composer.js'
import { injectComposerDraft } from '../composer-drafts.js'
import { ProjectCanvas } from './project-canvas.js'
import { Breadcrumbs, FileDetail, NodeDetail } from './project-detail.js'
import { advanceDiscovery, clip, createDiscovery, isDirectionReady, type DiscoveryState } from './project-discovery.js'
import { ProjectFileTree } from './project-file-tree.js'
import {
  breadcrumbs, deriveFiles, fileAt, filesForNode, folderTree, servesLine, targetNodeId,
  type JournalLine, type Location
} from './project-files.js'
import { ProjectIntake, type Message } from './project-intake.js'
import { amendTree, applyEvent, buildDispatchPlan, layoutTree, rootNode, type TreeNode } from './project-tree.js'

const ROOT_PANE_ID = 'preview-project-root'
const MAP: Location = { kind: 'map' }

const MODELS: ChatModel[] = [
  { id: 'gpt-5.6', provider: 'codex', displayName: 'GPT-5.6', description: 'OpenAI through Codex', contextWindow: 400_000,
    defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep reasoning' }], isDefault: true },
  { id: 'claude-fable-5-1', provider: 'claude', displayName: 'Claude Fable 5.1', description: 'Anthropic through Claude Code', contextWindow: 200_000,
    defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep reasoning' }], isDefault: false },
  { id: 'cursor-composer', provider: 'cursor', displayName: 'Composer', description: 'Cursor coding model', contextWindow: 200_000,
    defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }], isDefault: false },
  { id: 'antigravity-gemini', provider: 'antigravity', displayName: 'Gemini', description: 'Google through Antigravity', contextWindow: 200_000,
    defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep reasoning' }], isDefault: false }
]

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
const nodeSignature = (node: TreeNode) => `${node.state}|${node.summary}`

export function ProjectShellPreview() {
  const [messages, setMessages] = useState<Message[]>([])
  const [discovery, setDiscovery] = useState<DiscoveryState>(createDiscovery)
  const [selectedModel, setSelectedModel] = useState(MODELS[0]!.id)
  const [phase, setPhase] = useState<'intake' | 'canvas'>('intake')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [journal, setJournal] = useState<JournalLine[]>([])
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [location, setLocation] = useState<Location>(MAP)
  const [treeOpen, setTreeOpen] = useState(true)
  // What the user last saw, so growth while they were elsewhere is visible when they return.
  const [seenFiles, setSeenFiles] = useState<Record<string, string>>({})
  const [seenNodes, setSeenNodes] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const nextId = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLElement>(null)

  const selectedModelEntry = MODELS.find((model) => model.id === selectedModel) ?? MODELS[0]!
  const provider = selectedModelEntry.provider as ChatProvider
  const record = discovery.record
  const ready = discovery.asking === null && isDirectionReady(record)
  const layout = useMemo(() => layoutTree(tree), [tree])
  const files = useMemo(() => deriveFiles({ record, messages, nodes: tree, journal, edits }), [record, messages, tree, journal, edits])
  const folders = useMemo(() => folderTree(files), [files])
  const crumbs = useMemo(() => breadcrumbs(location, tree, files), [location, tree, files])
  const openFile = location.kind === 'file' ? fileAt(files, location.path) : null
  const openNode = location.kind === 'node' ? tree.find((node) => node.id === location.id) ?? null : null
  const targetId = targetNodeId(location, files)
  const targetNode = targetId ? tree.find((node) => node.id === targetId) ?? null : null

  const changedFiles = useMemo(() => new Set(files
    .filter((file) => file.path in seenFiles && seenFiles[file.path] !== file.content && openFile?.path !== file.path)
    .map((file) => file.path)), [files, seenFiles, openFile])
  const changedNodes = useMemo(() => new Set(tree
    .filter((node) => location.kind !== 'map' && node.id in seenNodes && seenNodes[node.id] !== nodeSignature(node))
    .map((node) => node.id)), [tree, seenNodes, location])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  // Looking at the map, or at a file, is what marks it seen.
  useEffect(() => {
    if (location.kind === 'map') setSeenNodes(Object.fromEntries(tree.map((node) => [node.id, nodeSignature(node)])))
  }, [location, tree])
  useEffect(() => {
    if (openFile) setSeenFiles((current) => ({ ...current, [openFile.path]: openFile.content }))
  }, [openFile])

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
        note(event.note)
      }, at))
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [phase, record])

  function note(text: string): void {
    setJournal((current) => [...current, { id: nextId.current++, text }])
  }

  function chooseSuggestion(prompt: string): void {
    injectComposerDraft(ROOT_PANE_ID, prompt)
    requestAnimationFrame(() => shellRef.current?.querySelector<HTMLTextAreaElement>('[data-ui="composer.input"]')?.focus())
  }

  function start(): void {
    const root = rootNode(record)
    const opening = [{ id: nextId.current++, text: 'Direction confirmed. Working from the record; only the next useful moves are planned.' }]
    const initial = deriveFiles({ record, messages, nodes: [root], journal: opening, edits: {} })
    setTree([root])
    setJournal(opening)
    setSeenFiles(Object.fromEntries(initial.map((file) => [file.path, file.content])))
    setLocation(MAP)
    setPhase('canvas')
  }

  function navigate(next: Location): void {
    setLocation(next)
  }

  function saveFile(path: string, content: string): void {
    setEdits((current) => ({ ...current, [path]: content }))
    if (path === 'direction/record.md') {
      setTree((current) => amendTree(current, 'Direction record edited directly. Scopes re-plan against the new wording on their next move.', 'root').nodes)
      note('You edited direction/record.md. Recorded as an amendment; every scope re-reads the record before its next dispatch.')
    } else {
      const owner = fileAt(files, path)?.owner ?? 'orchestrator'
      note(`You edited ${path}. The orchestrator re-read it${owner === 'worker' ? ' and will brief the worker' : ''}.`)
    }
  }

  async function send(text: string): Promise<void> {
    const clean = text.trim()
    if (!clean) return
    setSending(true)
    if (phase === 'canvas') {
      await wait(260)
      const { nodes, note: ripple } = amendTree(tree, clean, targetId)
      setTree(nodes)
      note(location.kind === 'file' ? `${ripple} (from ${location.path})` : ripple)
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

  const canvasNote = targetNode
    ? `Direction lands on “${targetNode.title}”`
    : 'Direction applies to the whole project; open a node or file to aim it'
  const placeholder = phase === 'intake' ? 'Describe what you want to create…'
    : targetNode ? `Add direction to “${targetNode.title}”…` : 'Add direction, a constraint, or a question…'

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
          {phase === 'canvas' && <button type="button" className="project-shell-tree-toggle"
            data-ui="preview.project-tree-toggle" aria-pressed={treeOpen}
            aria-label={treeOpen ? 'Hide project files' : 'Show project files'} onClick={() => setTreeOpen((open) => !open)}>
            {treeOpen ? <PanelLeftClose size={14} aria-hidden="true" /> : <PanelLeftOpen size={14} aria-hidden="true" />}
          </button>}
          <span className="project-shell-mark"><Compass size={15} aria-hidden="true" /></span>
          <strong>{phase === 'canvas' ? clip(record.idea, 56) : 'New project'}</strong>
          <span className="project-shell-kind">{phase === 'canvas' ? 'Building' : 'Project shell'}</span>
        </header>

        {phase === 'canvas'
          ? <div className="project-workstation" data-tree-open={treeOpen || undefined}>
            {treeOpen && <ProjectFileTree root={folders} openPath={openFile?.path ?? null} changed={changedFiles}
              onOpen={(path) => navigate({ kind: 'file', path })} />}
            <div className="project-stage">
              <Breadcrumbs crumbs={crumbs} onNavigate={navigate} />
              {location.kind === 'map' && <div className="project-tree-pane">
                <ProjectCanvas layout={layout} selectedId={null} changedIds={changedNodes}
                  onSelect={(id) => { if (id) navigate({ kind: 'node', id }) }} />
              </div>}
              {openNode && <div className="project-detail-pane">
                <NodeDetail node={openNode} nodes={tree} files={filesForNode(files, openNode.id)}
                  serves={servesLine(openNode, tree, record)} onNavigate={navigate} />
              </div>}
              {openFile && <div className="project-detail-pane"><FileDetail file={openFile} onSave={saveFile} /></div>}
              {location.kind !== 'map' && !openNode && !openFile && <div className="project-detail-pane">
                <p className="project-detail-missing">Nothing here yet. <button type="button" onClick={() => navigate(MAP)}>Back to the map</button></p>
              </div>}
            </div>
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
              placeholder={placeholder}
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
