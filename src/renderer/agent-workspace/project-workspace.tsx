import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Compass, History, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import type { ChatModel, ChatProvider } from '../../shared/chat.js'
import { Composer, type ComposerProps } from '../composer.js'
import type { ComposerLayout } from '../composer-layout.js'
import { injectComposerDraft } from '../composer-drafts.js'
import { ProjectCanvas } from '../preview/project-canvas.js'
import { buildCatchUp, countSince, reportLines } from '../preview/project-catchup.js'
import { CatchUpDetail, ProposalDetail } from '../preview/project-catchup-view.js'
import { canPropose, closureProgress, type AcknowledgedReport, type Proposal } from '../preview/project-closure.js'
import { Breadcrumbs, FileDetail, NodeDetail } from '../preview/project-detail.js'
import { advanceDiscovery, clip, createDiscovery, isDirectionReady, type DiscoveryState } from '../preview/project-discovery.js'
import { ProjectFileTree } from '../preview/project-file-tree.js'
import {
  breadcrumbs, deriveFiles, fileAt, filesForNode, folderTree, servesLine, targetNodeId,
  type FileEdit, type JournalLine, type Location
} from '../preview/project-files.js'
import { ProjectIntake, type Message } from '../preview/project-intake.js'
import { duration } from '../preview/project-time.js'
import { amendTree, applyEvent, buildDispatchPlan, layoutTree, rootNode, type TreeNode } from '../preview/project-tree.js'

export type ProjectWorkspaceComposerBridge = Pick<ComposerProps,
  'models' | 'selectedModel' | 'selectedReasoningEffort' | 'contextUsage' | 'provider' | 'planUsage'
  | 'onRefreshPlanUsage' | 'onModelChange' | 'onReasoningEffortChange' | 'cwd' | 'projectPath' | 'projectPending'
  | 'recentProjects' | 'onChooseProject' | 'onSelectProject' | 'onClearProject' | 'activeTurnId'>

export type ProjectWorkspaceProps = {
  paneId: string
  embedded?: boolean
  fixedComposerLayout?: ComposerLayout
  composerBridge?: ProjectWorkspaceComposerBridge | null
}
const MAP: Location = { kind: 'map' }
// Prototype pacing: an absence this long offers a catch-up on return; the clock re-renders
// relative times on this cadence.
const AWAY_AFTER_MS = 30_000
const CLOCK_MS = 15_000

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

export function ProjectWorkspace({ paneId, embedded = false, fixedComposerLayout, composerBridge = null }: ProjectWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [discovery, setDiscovery] = useState<DiscoveryState>(createDiscovery)
  const [selectedModel, setSelectedModel] = useState(MODELS[0]!.id)
  const [phase, setPhase] = useState<'intake' | 'canvas'>('intake')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [journal, setJournal] = useState<JournalLine[]>([])
  const [edits, setEdits] = useState<Record<string, FileEdit>>({})
  const [location, setLocation] = useState<Location>(MAP)
  const [treeOpen, setTreeOpen] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [confirmedAt, setConfirmedAt] = useState(0)
  const [caughtUpAt, setCaughtUpAt] = useState(0)
  const [awayFor, setAwayFor] = useState(0)
  const [reports, setReports] = useState<AcknowledgedReport[]>([])
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [acceptedAt, setAcceptedAt] = useState<number | null>(null)
  const lastInteraction = useRef(Date.now())
  // What the user last saw, so growth while they were elsewhere is visible when they return.
  const [seenFiles, setSeenFiles] = useState<Record<string, string>>({})
  const [seenNodes, setSeenNodes] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const nextId = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLElement>(null)

  const bridgeModels = composerBridge?.models ?? MODELS
  const bridgeModelId = composerBridge?.selectedModel ?? selectedModel
  const selectedModelEntry = bridgeModels.find((model) => model.id === bridgeModelId) ?? bridgeModels[0] ?? MODELS[0]!
  const provider = (composerBridge?.provider ?? selectedModelEntry.provider) as ChatProvider
  const record = discovery.record
  const ready = discovery.asking === null && isDirectionReady(record)
  const layout = useMemo(() => layoutTree(tree), [tree])
  const progress = useMemo(() => closureProgress(tree, record), [tree, record])
  const files = useMemo(() => deriveFiles({ record, messages, nodes: tree, journal, edits, confirmedAt, reports, progress, proposal, acceptedAt }),
    [record, messages, tree, journal, edits, confirmedAt, reports, progress, proposal, acceptedAt])
  const pending = useMemo(() => countSince(tree, caughtUpAt), [tree, caughtUpAt])
  const report = useMemo(() => location.kind === 'catchup' ? buildCatchUp({ nodes: tree, files, since: caughtUpAt, now, progress }) : null,
    [location, tree, files, caughtUpAt, now, progress])
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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => window.clearInterval(timer)
  }, [])

  // Coming back after an absence: remember how long, so the stage can offer a catch-up.
  useEffect(() => {
    if (phase !== 'canvas') return
    const touch = () => {
      const gap = Date.now() - lastInteraction.current
      lastInteraction.current = Date.now()
      if (gap >= AWAY_AFTER_MS) setAwayFor(gap)
    }
    const shell = shellRef.current
    shell?.addEventListener('pointerdown', touch)
    shell?.addEventListener('keydown', touch)
    document.addEventListener('visibilitychange', touch)
    return () => {
      shell?.removeEventListener('pointerdown', touch)
      shell?.removeEventListener('keydown', touch)
      document.removeEventListener('visibilitychange', touch)
    }
  }, [phase])

  // Looking at the map, or at a file, is what marks it seen.
  useEffect(() => {
    if (location.kind === 'map') setSeenNodes(Object.fromEntries(tree.map((node) => [node.id, nodeSignature(node)])))
  }, [location, tree])
  useEffect(() => {
    if (openFile) setSeenFiles((current) => ({ ...current, [openFile.path]: openFile.content }))
  }, [openFile])

  // The coordinator proposes completion only on the back of an acknowledged report that already
  // showed every gate met, with nothing changed since. Acknowledging is what licenses it.
  useEffect(() => {
    if (phase !== 'canvas' || proposal || acceptedAt) return
    const licensing = canPropose({ progress, reports, nodes: tree })
    if (!licensing) return
    const at = Date.now()
    const timer = window.setTimeout(() => {
      setProposal({ at, reportId: licensing.id })
      setTree((current) => [...current, {
        id: 'proposal', parent: 'root', kind: 'proposal', state: 'provisional', title: 'Completion proposed',
        summary: `Rests on report ${reports.indexOf(licensing) + 1}`, createdAt: at, updatedAt: at,
        detail: `Every gate is met and you acknowledged that state in report ${reports.indexOf(licensing) + 1}. Walk the acceptance, then accept or name the gap.`
      }])
      note(`Completion proposed. Every gate met; rests on progress report ${reports.indexOf(licensing) + 1}, which you acknowledged.`)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [phase, proposal, acceptedAt, progress, reports, tree])

  // Once building starts, the simulated root coordinator dispatches work on a timeline. The
  // record is fixed after Start, so the plan is derived once per build.
  useEffect(() => {
    if (phase !== 'canvas') return
    const timers: number[] = []
    let at = 0
    for (const event of buildDispatchPlan(record)) {
      at += event.delay
      timers.push(window.setTimeout(() => {
        setTree((current) => applyEvent(current, event, Date.now()))
        note(event.note)
      }, at))
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [phase, record])

  function note(text: string): void {
    setJournal((current) => [...current, { id: nextId.current++, at: Date.now(), text }])
  }

  function chooseSuggestion(prompt: string): void {
    injectComposerDraft(paneId, prompt)
    requestAnimationFrame(() => shellRef.current?.querySelector<HTMLTextAreaElement>('[data-ui="composer.input"]')?.focus())
  }

  function start(): void {
    const at = Date.now()
    const root = rootNode(record, at)
    const opening = [{ id: nextId.current++, at, text: 'Direction confirmed. Working from the record; only the next useful moves are planned.' }]
    const initial = deriveFiles({ record, messages, nodes: [root], journal: opening, edits: {}, confirmedAt: at,
      reports: [], progress: closureProgress([root], record), proposal: null, acceptedAt: null })
    setTree([root])
    setJournal(opening)
    setSeenFiles(Object.fromEntries(initial.map((file) => [file.path, file.content])))
    setConfirmedAt(at)
    setCaughtUpAt(at)
    setNow(at)
    lastInteraction.current = at
    setLocation(MAP)
    setPhase('canvas')
  }

  function navigate(next: Location): void {
    setLocation(next)
    setNow(Date.now())
    if (next.kind === 'catchup') setAwayFor(0)
  }

  function caughtUp(): void {
    const at = Date.now()
    if (report) {
      setReports((current) => [...current, { id: nextId.current++, since: report.since, at, changes: report.total, progress: report.progress, lines: reportLines(report) }])
      note(`Progress report ${reports.length + 1} acknowledged by you: ${report.progress.met} of ${report.progress.total} gates, ${report.total} changes.`)
    }
    setCaughtUpAt(at)
    setAwayFor(0)
    navigate(MAP)
  }

  function accept(): void {
    const at = Date.now()
    setAcceptedAt(at)
    setProposal(null)
    setTree((current) => current.map((node) => node.id === 'proposal' ? { ...node, state: 'complete', summary: 'Accepted', updatedAt: at } : node))
    note('Completion accepted by you. Handoff written; the tree is now the project’s history. You can reopen it with new direction any time.')
    navigate({ kind: 'file', path: 'handoff.md' })
  }

  /** Post-completion direction: clear Complete, record an amendment, reset catch-up from now. */
  function reopen(clean: string): void {
    const at = Date.now()
    const aim = targetId ?? 'root'
    const { nodes, note: ripple } = amendTree(tree, clean, aim, at)
    setAcceptedAt(null)
    setProposal(null)
    setCaughtUpAt(at)
    setAwayFor(0)
    setTree(nodes)
    note(`Project reopened: ${ripple} Handoff and prior reports stay on file; acknowledge progress again before the next completion proposal.`)
    navigate(MAP)
  }

  function withdrawProposal(reason: string): void {
    setProposal(null)
    setTree((current) => current.filter((node) => node.id !== 'proposal'))
    note(`Proposal withdrawn: you named a gap — ${clip(reason, 80)}`)
  }

  function saveFile(path: string, content: string): void {
    const at = Date.now()
    setEdits((current) => ({ ...current, [path]: { content, at } }))
    if (path === 'direction/record.md') {
      setTree((current) => amendTree(current, 'Direction record edited directly. Scopes re-plan against the new wording on their next move.', 'root', at).nodes)
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
      if (acceptedAt) {
        reopen(clean)
        setSending(false)
        return
      }
      const gap = location.kind === 'proposal' && proposal
      const base = gap ? tree.filter((node) => node.id !== 'proposal') : tree
      const { nodes, note: ripple } = amendTree(base, clean, gap ? 'root' : targetId, Date.now())
      if (gap) withdrawProposal(clean)
      setTree(nodes)
      note(location.kind === 'file' ? `${ripple} (from ${location.path})` : ripple)
      if (gap) navigate(MAP)
      setSending(false)
      return
    }
    setMessages((current) => [...current, { id: nextId.current++, at: Date.now(), role: 'user', text: clean }])
    const { state, reply } = advanceDiscovery(discovery, clean)
    await wait(420)
    setDiscovery(state)
    setMessages((current) => [...current, { id: nextId.current++, at: Date.now(), role: 'coordinator', text: reply }])
    setSending(false)
  }

  const canvasNote = acceptedAt ? 'Complete. New direction reopens the project as an amendment.'
    : location.kind === 'proposal' ? 'Accept above, or name the gap here to withdraw the proposal'
    : targetNode ? `Direction lands on “${targetNode.title}”`
    : 'Direction applies to the whole project; open a node or file to aim it'
  const placeholder = phase === 'intake' ? 'Describe what you want to create…'
    : acceptedAt ? 'Reopen with new direction…'
    : location.kind === 'proposal' ? 'Name the gap…'
    : targetNode ? `Add direction to “${targetNode.title}”…` : 'Add direction, a constraint, or a question…'

  const shellAttrs = embedded
    ? { 'data-agent-workspace': true as const }
    : { 'data-preview-project-shell': true as const }

  return <section className="project-shell" ref={shellRef} {...shellAttrs} aria-label="Project">
        <header className="project-shell-header">
          {!embedded && <span className="project-shell-grip" aria-hidden="true">⠿</span>}
          {phase === 'canvas' && <button type="button" className="project-shell-tree-toggle"
            data-ui="preview.project-tree-toggle" aria-pressed={treeOpen}
            aria-label={treeOpen ? 'Hide project files' : 'Show project files'} onClick={() => setTreeOpen((open) => !open)}>
            {treeOpen ? <PanelLeftClose size={14} aria-hidden="true" /> : <PanelLeftOpen size={14} aria-hidden="true" />}
          </button>}
          <span className="project-shell-mark"><Compass size={15} aria-hidden="true" /></span>
          <strong>{phase === 'canvas' ? clip(record.idea, 56) : 'New project'}</strong>
          {phase === 'canvas' && <button type="button" className="project-shell-catchup" data-ui="preview.project-catchup"
            data-pending={pending > 0 || undefined} aria-pressed={location.kind === 'catchup'}
            title="What changed since you last caught up" onClick={() => navigate({ kind: 'catchup' })}>
            <History size={13} aria-hidden="true" /> Catch up{pending > 0 && <b>{pending}</b>}
          </button>}
          {proposal && phase === 'canvas' && !acceptedAt && <button type="button" className="project-shell-proposal" data-ui="preview.project-proposal"
            aria-pressed={location.kind === 'proposal'} onClick={() => navigate({ kind: 'proposal' })}>Completion proposed</button>}
          <span className="project-shell-kind" data-complete={acceptedAt ? 'true' : undefined}>
            {phase !== 'canvas' ? 'Project shell' : acceptedAt ? 'Complete' : proposal ? 'Closing' : 'Building'}
          </span>
        </header>

        {phase === 'canvas'
          ? <div className="project-workstation" data-tree-open={treeOpen || undefined}>
            {treeOpen && <ProjectFileTree root={folders} openPath={openFile?.path ?? null} changed={changedFiles} now={now}
              onOpen={(path) => navigate({ kind: 'file', path })} />}
            <div className="project-stage">
              <Breadcrumbs crumbs={crumbs} onNavigate={navigate} />
              {awayFor > 0 && pending > 0 && location.kind !== 'catchup' && <div className="project-away" role="status">
                <span>You were away {duration(awayFor)}; {pending} {pending === 1 ? 'thing' : 'things'} changed.</span>
                <button type="button" data-ui="preview.project-catchup" onClick={() => navigate({ kind: 'catchup' })}>Catch up</button>
                <button type="button" data-ui="preview.project-away-dismiss" onClick={() => setAwayFor(0)} aria-label="Dismiss">×</button>
              </div>}
              {location.kind === 'map' && <div className="project-tree-pane">
                <ProjectCanvas layout={layout} selectedId={null} changedIds={changedNodes}
                  onSelect={(id) => { if (id) navigate({ kind: 'node', id }) }} />
              </div>}
              {report && <div className="project-detail-pane"><CatchUpDetail report={report} onNavigate={navigate} onCaughtUp={caughtUp} /></div>}
              {location.kind === 'proposal' && <div className="project-detail-pane">
                {proposal
                  ? <ProposalDetail proposal={proposal} reports={reports} progress={progress} record={record} acceptedAt={acceptedAt} now={now}
                    onNavigate={navigate} onAccept={accept} />
                  : <p className="project-detail-missing">No proposal is open. <button type="button" onClick={() => navigate(MAP)}>Back to the map</button></p>}
              </div>}
              {openNode && <div className="project-detail-pane">
                <NodeDetail node={openNode} nodes={tree} files={filesForNode(files, openNode.id)}
                  serves={servesLine(openNode, tree, record)} now={now} onNavigate={navigate} />
              </div>}
              {openFile && <div className="project-detail-pane"><FileDetail file={openFile} now={now} onSave={saveFile} /></div>}
              {(location.kind === 'node' || location.kind === 'file') && !openNode && !openFile && <div className="project-detail-pane">
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
              models={bridgeModels}
              selectedModel={bridgeModelId}
              selectedReasoningEffort={composerBridge?.selectedReasoningEffort ?? selectedModelEntry.defaultReasoningEffort}
              contextUsage={composerBridge?.contextUsage ?? null}
              provider={provider}
              planUsage={composerBridge?.planUsage ?? null}
              onRefreshPlanUsage={composerBridge?.onRefreshPlanUsage ?? (async () => {})}
              onModelChange={composerBridge?.onModelChange ?? (async (modelId) => setSelectedModel(modelId))}
              onReasoningEffortChange={composerBridge?.onReasoningEffortChange ?? (async () => {})}
              onSend={async (text) => send(text)}
              onStop={async () => {}}
              paused={false}
              onResume={async () => {}}
              onInspectContext={() => {}}
              cwd={composerBridge?.cwd ?? '/preview/closedai'}
              projectPath={composerBridge?.projectPath ?? '/preview/closedai'}
              projectPending={composerBridge?.projectPending}
              recentProjects={composerBridge?.recentProjects ?? []}
              onChooseProject={composerBridge?.onChooseProject ?? (async () => {})}
              onSelectProject={composerBridge?.onSelectProject ?? (async () => {})}
              onClearProject={composerBridge?.onClearProject ?? (async () => {})}
              activeTurnId={composerBridge?.activeTurnId ?? null}
              paneId={paneId}
              fixedLayout={fixedComposerLayout}
            />
          </div>
          <span className="project-provider-note"><AppWindow size={12} aria-hidden="true" />
            {phase === 'canvas' ? canvasNote : '4 providers available to the coordinator'}
          </span>
        </footer>
      </section>
}
