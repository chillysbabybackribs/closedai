import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import type { ChatProvider, ChatTranscriptItem } from '../../shared/chat.js'
import type { ComposerProps } from '../composer.js'
import type { ComposerLayout } from '../composer-layout.js'
import { injectComposerDraft } from '../composer-drafts.js'
import { buildCatchUp, countSince, reportLines } from './project-catchup.js'
import { closureProgress, type AcknowledgedReport, type Proposal } from './project-closure.js'
import { advanceDiscovery, clip, isDirectionReady, syncDiscoveryWithItems } from './project-discovery.js'
import {
  breadcrumbs, deriveFiles, fileAt, folderTree, targetNodeId,
  type FileEdit, type Location
} from './project-files.js'
import { transcriptItemsToMessages, type Message } from './project-intake.js'
import type { ProjectCanvasFixture } from './project-canvas-fixture.js'
import { amendTree, layoutTree, rootNode } from './project-tree.js'
import { projectView } from './project-view.js'
import { useProjectState } from './use-project-state.js'
import { projectNodeSignature, useProjectWorkspaceEffects } from './use-project-workspace-effects.js'
import {
  PROJECT_WORKSPACE_CLOCK_MS,
  PROJECT_WORKSPACE_MAP,
  PROJECT_WORKSPACE_MODELS,
  projectWorkspaceWait
} from './project-workspace-fixture.js'
import { ProjectWorkspaceShellChrome } from './project-workspace-shell-chrome.js'

export type ProjectWorkspaceComposerBridge = Pick<ComposerProps,
  'models' | 'selectedModel' | 'selectedReasoningEffort' | 'contextUsage' | 'provider' | 'planUsage'
  | 'onRefreshPlanUsage' | 'onModelChange' | 'onReasoningEffortChange' | 'cwd' | 'projectPath' | 'projectPending'
  | 'recentProjects' | 'onChooseProject' | 'onSelectProject' | 'onClearProject' | 'activeTurnId'> & {
  items?: ChatTranscriptItem[]
  running?: boolean
  paused?: boolean
  pausedTurnId?: string | null
  onStop?: () => Promise<void>
  onResume?: () => Promise<void>
  onSend?: (text: string) => Promise<void>
}

export type ProjectWorkspaceChatAppearance = {
  zoom: number
  fontSize: number
  composerFontSize: number
}

export type ProjectWorkspaceProps = {
  paneId: string
  embedded?: boolean
  fixedComposerLayout?: ComposerLayout
  composerBridge?: ProjectWorkspaceComposerBridge | null
  /** Match ordinary chat panes: zoom and message/composer font sizes from Appearance settings. */
  chatAppearance?: ProjectWorkspaceChatAppearance
  /** Preview and tests: a pre-built canvas held in memory instead of a project on disk. */
  canvasFixture?: ProjectCanvasFixture | null
  /** Project whose `.closedai/project.json` this workspace reads and writes; omit for in-memory state. */
  projectPath?: string | null
}
const MAP = PROJECT_WORKSPACE_MAP
const START_NOTE = 'Direction confirmed. Working from the record; only the next useful moves are planned.'
/** What the coordinator chat hears when Start is pressed; its building-phase guidance takes it from here. */
const START_MESSAGE = 'The user pressed Start building. The direction record is confirmed and the project store is now in the building phase. Read closedai_project.snapshot, write the first tasks, and dispatch the first one to a worker chat.'

export function ProjectWorkspace({ paneId, embedded = false, fixedComposerLayout, composerBridge = null, chatAppearance, canvasFixture = null, projectPath = null }: ProjectWorkspaceProps) {
  const { file, mutate } = useProjectState(projectPath, canvasFixture)
  const { discovery, phase, tree, journal, confirmedAt, caughtUpAt, acceptedAt } = useMemo(() => projectView(file), [file])
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedModel, setSelectedModel] = useState(PROJECT_WORKSPACE_MODELS[0]!.id)
  const [edits, setEdits] = useState<Record<string, FileEdit>>({})
  const [location, setLocation] = useState<Location>(MAP)
  const [treeOpen, setTreeOpen] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [awayFor, setAwayFor] = useState(0)
  // Reports and the open proposal are still local: slice D moves them into the store.
  const [reports, setReports] = useState<AcknowledgedReport[]>([])
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const lastInteraction = useRef(Date.now())
  // What the user last saw, so growth while they were elsewhere is visible when they return.
  const [seenFiles, setSeenFiles] = useState<Record<string, string>>({})
  const [seenNodes, setSeenNodes] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const nextId = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLElement>(null)

  const bridgeModels = composerBridge?.models ?? PROJECT_WORKSPACE_MODELS
  const bridgeModelId = composerBridge?.selectedModel ?? selectedModel
  const selectedModelEntry = bridgeModels.find((model) => model.id === bridgeModelId) ?? bridgeModels[0] ?? PROJECT_WORKSPACE_MODELS[0]!
  const provider = (composerBridge?.provider ?? selectedModelEntry.provider) as ChatProvider
  const bridgeMessages = useMemo(() => {
    if (!composerBridge?.items) return null
    return transcriptItemsToMessages(composerBridge.items)
  }, [composerBridge?.items])
  const activeMessages = bridgeMessages ?? messages
  const record = discovery.record
  const ready = discovery.asking === null && isDirectionReady(record)
  const layout = useMemo(() => layoutTree(tree), [tree])
  const progress = useMemo(() => closureProgress(tree, record), [tree, record])
  const files = useMemo(() => deriveFiles({ record, messages: activeMessages, nodes: tree, journal, edits, confirmedAt, reports, progress, proposal, acceptedAt }),
    [record, activeMessages, tree, journal, edits, confirmedAt, reports, progress, proposal, acceptedAt])
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
    .filter((node) => location.kind !== 'map' && node.id in seenNodes && seenNodes[node.id] !== projectNodeSignature(node))
    .map((node) => node.id)), [tree, seenNodes, location])

  // Prototype intake: the direction record is read off the live transcript by position until the
  // coordinator writes it itself (slice B). Writes only when the reading changes, so it settles.
  useEffect(() => {
    const items = composerBridge?.items
    if (phase !== 'intake' || !items?.length) return
    const next = syncDiscoveryWithItems(discovery, items)
    if (next.asking === discovery.asking && JSON.stringify(next.record) === JSON.stringify(discovery.record)) return
    void mutate({ type: 'direction', direction: next.record, asking: next.asking })
  }, [composerBridge?.items, discovery, phase, mutate])

  const liveTranscript = composerBridge != null
  useEffect(() => {
    if (liveTranscript) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [activeMessages, sending, composerBridge?.running, liveTranscript])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), PROJECT_WORKSPACE_CLOCK_MS)
    return () => window.clearInterval(timer)
  }, [])

  function note(text: string): void {
    void mutate({ type: 'journal', text })
  }

  useProjectWorkspaceEffects({
    phase, shellRef, lastInteraction, setAwayFor, setSeenFiles, setSeenNodes, location, tree, files, openFile,
    proposal, acceptedAt, progress, reports, setProposal, mutate
  })

  function chooseSuggestion(prompt: string): void {
    injectComposerDraft(paneId, prompt)
    requestAnimationFrame(() => shellRef.current?.querySelector<HTMLTextAreaElement>('[data-ui="composer.input"]')?.focus())
  }

  function start(): void {
    const at = Date.now()
    // The store is in the building phase before the coordinator reads it, so its first snapshot
    // already shows the root node.
    void mutate({ type: 'start', root: rootNode(record, at), note: START_NOTE })
      .then(() => composerBridge?.onSend?.(START_MESSAGE))
    setNow(at)
    lastInteraction.current = at
    setLocation(MAP)
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
      void mutate({ type: 'caughtUp', note: `Progress report ${reports.length + 1} acknowledged by you: ${report.progress.met} of ${report.progress.total} gates, ${report.total} changes.` })
    } else {
      void mutate({ type: 'caughtUp' })
    }
    setAwayFor(0)
    navigate(MAP)
  }

  function accept(): void {
    setProposal(null)
    void mutate([
      { type: 'tree', events: [{ update: { id: 'proposal', state: 'complete', summary: 'Accepted' } }] },
      { type: 'phase', phase: 'complete', note: 'Completion accepted by you. Handoff written; the tree is now the project’s history. You can reopen it with new direction any time.' }
    ])
    navigate({ kind: 'file', path: 'handoff.md' })
  }

  /** Post-completion direction: clear Complete, record an amendment, reset catch-up from now. */
  function reopen(clean: string): void {
    const { nodes, note: ripple } = amendTree(tree, clean, targetId ?? 'root', Date.now())
    setProposal(null)
    setAwayFor(0)
    void mutate([
      { type: 'tree', events: [{ replace: nodes }] },
      { type: 'phase', phase: 'building', note: `Project reopened: ${ripple} Handoff and prior reports stay on file; acknowledge progress again before the next completion proposal.` }
    ])
    navigate(MAP)
  }

  function saveFile(path: string, content: string): void {
    const at = Date.now()
    setEdits((current) => ({ ...current, [path]: { content, at } }))
    if (path === 'direction/record.md') {
      const { nodes } = amendTree(tree, 'Direction record edited directly. Scopes re-plan against the new wording on their next move.', 'root', at)
      void mutate({ type: 'tree', events: [{ replace: nodes }], note: 'You edited direction/record.md. Recorded as an amendment; every scope re-reads the record before its next dispatch.' })
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
      if (composerBridge?.onSend) {
        void composerBridge.onSend(clean)
      }
      await projectWorkspaceWait(260)
      if (acceptedAt) {
        reopen(clean)
        setSending(false)
        return
      }
      const gap = location.kind === 'proposal' && proposal
      const base = gap ? tree.filter((node) => node.id !== 'proposal') : tree
      const { nodes, note: ripple } = amendTree(base, clean, gap ? 'root' : targetId, Date.now())
      if (gap) setProposal(null)
      void mutate([
        ...(gap ? [{ type: 'tree' as const, events: [{ remove: { id: 'proposal' } }], note: `Proposal withdrawn: you named a gap — ${clip(clean, 80)}` }] : []),
        { type: 'tree', events: [{ replace: nodes }], note: location.kind === 'file' ? `${ripple} (from ${location.path})` : ripple }
      ])
      if (gap) navigate(MAP)
      setSending(false)
      return
    }
    if (composerBridge?.onSend) {
      try {
        await composerBridge.onSend(clean)
      } finally {
        setSending(false)
      }
      return
    }
    // Standalone preview: a scripted coordinator stands in for the live chat.
    setMessages((current) => [...current, { id: nextId.current++, at: Date.now(), role: 'user', text: clean }])
    const { state, reply } = advanceDiscovery(discovery, clean)
    await projectWorkspaceWait(420)
    void mutate({ type: 'direction', direction: state.record, asking: state.asking })
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
  const zoom = chatAppearance?.zoom ?? 100
  const fontSize = chatAppearance?.fontSize ?? 14
  const composerFontSize = chatAppearance?.composerFontSize ?? 15
  const intakeTranscript = composerBridge && (composerBridge.items?.length ?? 0) > 0
    ? {
        paneId,
        items: composerBridge.items!,
        activeTurnId: composerBridge.activeTurnId ?? null,
        pausedTurnId: composerBridge.pausedTurnId ?? null,
        running: composerBridge.running ?? false
      }
    : undefined
  const hasIntakeConversation = (composerBridge?.items?.length ?? 0) > 0 || activeMessages.length > 0

  const zoomStyle = chatAppearance ? {
    '--chat-zoom': zoom / 100,
    '--chat-zoom-inverse': 100 / zoom,
    '--chat-font-size': `${fontSize}px`,
    '--chat-fs-body': `${fontSize}px`,
    '--chat-fs-markdown': `${fontSize}px`,
    '--composer-font-size': `${composerFontSize}px`
  } as CSSProperties : undefined

  return <section className={`project-shell${embedded ? ' project-shell-embedded' : ''}${chatAppearance ? ' project-shell-chat prompt-chat' : ''}`} ref={shellRef} {...shellAttrs}
    aria-label="Project"
    data-ui-surface={chatAppearance ? 'chat' as const : undefined}
    data-zoom={chatAppearance ? zoom : undefined}
    style={zoomStyle}>
    <ProjectWorkspaceShellChrome
      paneId={paneId}
      embedded={embedded}
      fixedComposerLayout={fixedComposerLayout}
      composerBridge={composerBridge}
      phase={phase}
      treeOpen={treeOpen}
      setTreeOpen={setTreeOpen}
      record={record}
      pending={pending}
      location={location}
      navigate={navigate}
      proposal={proposal}
      acceptedAt={acceptedAt}
      folders={folders}
      openFile={openFile}
      changedFiles={changedFiles}
      now={now}
      crumbs={crumbs}
      awayFor={awayFor}
      setAwayFor={setAwayFor}
      layout={layout}
      changedNodes={changedNodes}
      report={report}
      caughtUp={caughtUp}
      tree={tree}
      files={files}
      progress={progress}
      reports={reports}
      accept={accept}
      openNode={openNode}
      saveFile={saveFile}
      mapLocation={MAP}
      activeMessages={activeMessages}
      sending={sending}
      ready={ready}
      chooseSuggestion={chooseSuggestion}
      start={start}
      intakeTranscript={intakeTranscript}
      hasIntakeConversation={hasIntakeConversation}
      liveTranscript={liveTranscript}
      scrollRef={scrollRef}
      placeholder={placeholder}
      bridgeModels={bridgeModels}
      bridgeModelId={bridgeModelId}
      selectedModelEntry={selectedModelEntry}
      provider={provider}
      send={send}
      canvasNote={canvasNote}
      onModelChangeFallback={async (modelId) => setSelectedModel(modelId)}
    />
  </section>
}
