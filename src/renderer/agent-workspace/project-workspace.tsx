import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import type { ChatProvider, ChatTranscriptItem } from '../../shared/chat.js'
import type { ComposerProps } from '../composer.js'
import type { ComposerLayout } from '../composer-layout.js'
import { injectComposerDraft } from '../composer-drafts.js'
import { buildCatchUp, countSince, reportLines } from './project-catchup.js'
import { closureProgress, type AcknowledgedReport, type Proposal } from './project-closure.js'
import { advanceDiscovery, clip, createDiscovery, isDirectionReady, syncDiscoveryWithItems, type DiscoveryState } from './project-discovery.js'
import {
  breadcrumbs, deriveFiles, fileAt, folderTree, targetNodeId,
  type FileEdit, type JournalLine, type Location
} from './project-files.js'
import { transcriptItemsToMessages, type Message } from './project-intake.js'
import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import type { ProjectCanvasFixture } from './project-canvas-fixture.js'
import { amendTree, layoutTree, rootNode, type TreeNode } from './project-tree.js'
import { projectNodeSignature, useProjectWorkspaceEffects } from './use-project-workspace-effects.js'
import {
  PROJECT_WORKSPACE_CLOCK_MS,
  PROJECT_WORKSPACE_MAP,
  PROJECT_WORKSPACE_MODELS,
  projectWorkspaceInitialHydration,
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
  /** Preview and tests: skip intake and simulated dispatch timers when canvas is pre-seeded. */
  canvasFixture?: ProjectCanvasFixture | null
  /** Durable state from main; hydrates once when the workspace would otherwise start empty. */
  persistedSnapshot?: ProjectSnapshot | null
}
const MAP = PROJECT_WORKSPACE_MAP

export function ProjectWorkspace({ paneId, embedded = false, fixedComposerLayout, composerBridge = null, chatAppearance, canvasFixture = null, persistedSnapshot = null }: ProjectWorkspaceProps) {
  const fixtureHydration = useMemo(() => projectWorkspaceInitialHydration(canvasFixture, null), [canvasFixture])
  const persistedApplied = useRef(false)
  const [skipSimulatedDispatch, setSkipSimulatedDispatch] = useState(() => fixtureHydration?.skipSimulatedDispatch ?? false)
  const [messages, setMessages] = useState<Message[]>([])
  const [discovery, setDiscovery] = useState<DiscoveryState>(() => fixtureHydration?.discovery ?? createDiscovery())
  const [selectedModel, setSelectedModel] = useState(PROJECT_WORKSPACE_MODELS[0]!.id)
  const [phase, setPhase] = useState<'intake' | 'canvas'>(() => (fixtureHydration?.phase ?? 'intake'))
  const [tree, setTree] = useState<TreeNode[]>(() => fixtureHydration?.tree ?? [])
  const [journal, setJournal] = useState<JournalLine[]>(() => fixtureHydration?.journal ?? [])
  const [edits, setEdits] = useState<Record<string, FileEdit>>({})
  const [location, setLocation] = useState<Location>(MAP)
  const [treeOpen, setTreeOpen] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [confirmedAt, setConfirmedAt] = useState(() => fixtureHydration?.confirmedAt ?? 0)
  const [caughtUpAt, setCaughtUpAt] = useState(() => fixtureHydration?.caughtUpAt ?? 0)
  const [awayFor, setAwayFor] = useState(0)
  const [reports, setReports] = useState<AcknowledgedReport[]>([])
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [acceptedAt, setAcceptedAt] = useState<number | null>(() => fixtureHydration?.acceptedAt ?? null)
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

  useEffect(() => {
    if (embedded || !composerBridge?.items || composerBridge.items.length === 0) return
    setDiscovery((current) => syncDiscoveryWithItems(current, composerBridge.items!))
  }, [composerBridge?.items, embedded])

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
    setJournal((current) => [...current, { id: nextId.current++, at: Date.now(), text }])
  }

  useProjectWorkspaceEffects({
    phase, shellRef, lastInteraction, setAwayFor, canvasFixture, persistedApplied, persistedSnapshot,
    setDiscovery, setPhase, setTree, setJournal, setConfirmedAt, setCaughtUpAt, setAcceptedAt, setSkipSimulatedDispatch,
    setSeenFiles, setSeenNodes, fixtureHydration, location, tree, openFile, proposal, acceptedAt, progress, reports,
    setProposal, record, skipSimulatedDispatch, note
  })

  function chooseSuggestion(prompt: string): void {
    injectComposerDraft(paneId, prompt)
    requestAnimationFrame(() => shellRef.current?.querySelector<HTMLTextAreaElement>('[data-ui="composer.input"]')?.focus())
  }

  function start(): void {
    const at = Date.now()
    const root = rootNode(record, at)
    const opening = [{ id: nextId.current++, at, text: 'Direction confirmed. Working from the record; only the next useful moves are planned.' }]
    const initial = deriveFiles({ record, messages: activeMessages, nodes: [root], journal: opening, edits: {}, confirmedAt: at,
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
      if (gap) withdrawProposal(clean)
      setTree(nodes)
      note(location.kind === 'file' ? `${ripple} (from ${location.path})` : ripple)
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
    setMessages((current) => [...current, { id: nextId.current++, at: Date.now(), role: 'user', text: clean }])
    const { state, reply } = advanceDiscovery(discovery, clean)
    await projectWorkspaceWait(420)
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
