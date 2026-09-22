import { AppWindow, Compass, History, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { RefObject } from 'react'

import type { ChatModel, ChatProvider, ChatTranscriptItem } from '../../shared/chat.js'
import { Composer } from '../composer.js'
import type { ComposerLayout } from '../composer-layout.js'
import { ProjectCanvas } from './project-canvas.js'
import type { AcknowledgedReport, Proposal } from './project-closure.js'
import { CatchUpDetail, ProposalDetail } from './project-catchup-view.js'
import { Breadcrumbs, FileDetail, NodeDetail } from './project-detail.js'
import { clip } from './project-discovery.js'
import type { DiscoveryState } from './project-discovery.js'
import { ProjectFileTree } from './project-file-tree.js'
import type { Crumb, Location, ProjectFile, ProjectFolder } from './project-files.js'
import { filesForNode, servesLine } from './project-files.js'
import type { CatchUpReport } from './project-catchup.js'
import type { Progress } from './project-closure.js'
import type { TreeLayout } from './project-tree.js'
import { ProjectIntake, type Message } from './project-intake.js'
import { duration } from './project-time.js'
import type { TreeNode } from './project-tree.js'
import type { ProjectWorkspaceComposerBridge } from './project-workspace.js'

export type ProjectWorkspaceShellChromeProps = {
  paneId: string
  embedded: boolean
  fixedComposerLayout?: ComposerLayout
  composerBridge: ProjectWorkspaceComposerBridge | null
  phase: 'intake' | 'canvas'
  treeOpen: boolean
  setTreeOpen: (update: (open: boolean) => boolean) => void
  record: DiscoveryState['record']
  pending: number
  location: Location
  navigate: (next: Location) => void
  proposal: Proposal | null
  acceptedAt: number | null
  folders: ProjectFolder
  openFile: ProjectFile | null
  changedFiles: Set<string>
  now: number
  crumbs: Crumb[]
  awayFor: number
  setAwayFor: (value: number) => void
  layout: TreeLayout
  changedNodes: Set<string>
  report: CatchUpReport | null
  caughtUp: () => void
  tree: TreeNode[]
  files: ProjectFile[]
  progress: Progress
  reports: AcknowledgedReport[]
  accept: () => void
  openNode: TreeNode | null
  saveFile: (path: string, content: string) => void
  mapLocation: Location
  activeMessages: Message[]
  sending: boolean
  ready: boolean
  chooseSuggestion: (prompt: string) => void
  start: () => void
  intakeTranscript?: {
    paneId: string
    items: ChatTranscriptItem[]
    activeTurnId: string | null
    pausedTurnId: string | null
    running: boolean
  }
  hasIntakeConversation: boolean
  liveTranscript: boolean
  scrollRef: RefObject<HTMLDivElement | null>
  placeholder: string
  bridgeModels: ChatModel[]
  bridgeModelId: string
  selectedModelEntry: ChatModel
  provider: ChatProvider
  send: (text: string) => Promise<void>
  canvasNote: string
  onModelChangeFallback: (modelId: string) => Promise<void>
}

export function ProjectWorkspaceShellChrome(props: ProjectWorkspaceShellChromeProps) {
  const {
    paneId, embedded, fixedComposerLayout, composerBridge, phase, treeOpen, setTreeOpen, record, pending, location,
    navigate, proposal, acceptedAt, folders, openFile, changedFiles, now, crumbs, awayFor, setAwayFor, layout,
    changedNodes, report, caughtUp, tree, files, progress, reports, accept, openNode, saveFile, mapLocation,
    activeMessages, sending, ready, chooseSuggestion, start, intakeTranscript, hasIntakeConversation, liveTranscript,
    scrollRef, placeholder, bridgeModels, bridgeModelId, selectedModelEntry, provider, send, canvasNote,
    onModelChangeFallback
  } = props

  return <>
    <header className="project-shell-header">
      {!embedded && <span className="project-shell-grip" aria-hidden="true">⠿</span>}
      {phase === 'canvas' && <button type="button" className="project-shell-tree-toggle"
        data-ui="agent.project-tree-toggle" aria-pressed={treeOpen}
        aria-label={treeOpen ? 'Hide project files' : 'Show project files'} onClick={() => setTreeOpen((open) => !open)}>
        {treeOpen ? <PanelLeftClose size={14} aria-hidden="true" /> : <PanelLeftOpen size={14} aria-hidden="true" />}
      </button>}
      <span className="project-shell-mark"><Compass size={15} aria-hidden="true" /></span>
      <strong>{phase === 'canvas' ? clip(record.idea, 56) : 'New project'}</strong>
      {phase === 'canvas' && <button type="button" className="project-shell-catchup" data-ui="agent.project-catchup"
        data-pending={pending > 0 || undefined} aria-pressed={location.kind === 'catchup'}
        title="What changed since you last caught up" onClick={() => navigate({ kind: 'catchup' })}>
        <History size={13} aria-hidden="true" /> Catch up{pending > 0 && <b>{pending}</b>}
      </button>}
      {proposal && phase === 'canvas' && !acceptedAt && <button type="button" className="project-shell-proposal" data-ui="agent.project-proposal"
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
            <button type="button" data-ui="agent.project-catchup" onClick={() => navigate({ kind: 'catchup' })}>Catch up</button>
            <button type="button" data-ui="agent.project-away-dismiss" onClick={() => setAwayFor(0)} aria-label="Dismiss">×</button>
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
              : <p className="project-detail-missing">No proposal is open. <button type="button" onClick={() => navigate(mapLocation)}>Back to the map</button></p>}
          </div>}
          {openNode && <div className="project-detail-pane">
            <NodeDetail node={openNode} nodes={tree} files={filesForNode(files, openNode.id)}
              serves={servesLine(openNode, tree, record)} now={now} onNavigate={navigate} />
          </div>}
          {openFile && <div className="project-detail-pane"><FileDetail file={openFile} now={now} onSave={saveFile} /></div>}
          {(location.kind === 'node' || location.kind === 'file') && !openNode && !openFile && <div className="project-detail-pane">
            <p className="project-detail-missing">Nothing here yet. <button type="button" onClick={() => navigate(mapLocation)}>Back to the map</button></p>
          </div>}
        </div>
      </div>
      : <div className={`project-shell-body${embedded ? ' is-agent-embedded' : ''}${hasIntakeConversation ? ' has-conversation' : ''}${liveTranscript ? ' has-live-transcript' : ''}`}
        ref={liveTranscript ? undefined : scrollRef}>
        <ProjectIntake messages={activeMessages} sending={sending || (composerBridge?.running ?? false)} record={record} ready={ready}
          onSuggestion={chooseSuggestion} onStart={start} transcript={intakeTranscript} showDirectionRecord={!embedded} />
      </div>}

    <footer className="project-shell-footer">
      {phase === 'intake' && !hasIntakeConversation && !embedded && <p className="project-shell-help">
        Describe what you want to exist and anything you already care about. The coordinator asks for the rest.
      </p>}
      <div className="composer project-shell-composer">
        <Composer
          enabled={composerBridge ? true : !sending}
          running={composerBridge?.running ?? sending}
          placeholder={placeholder}
          models={bridgeModels}
          selectedModel={bridgeModelId}
          selectedReasoningEffort={composerBridge?.selectedReasoningEffort ?? selectedModelEntry.defaultReasoningEffort}
          contextUsage={composerBridge?.contextUsage ?? null}
          provider={provider}
          planUsage={composerBridge?.planUsage ?? null}
          onRefreshPlanUsage={composerBridge?.onRefreshPlanUsage ?? (async () => {})}
          onModelChange={composerBridge?.onModelChange ?? onModelChangeFallback}
          onReasoningEffortChange={composerBridge?.onReasoningEffortChange ?? (async () => {})}
          onSend={async (text) => send(text)}
          onStop={composerBridge?.onStop ?? (async () => {})}
          paused={composerBridge?.paused ?? false}
          onResume={composerBridge?.onResume ?? (async () => {})}
          onInspectContext={() => {}}
          cwd={composerBridge?.cwd ?? ''}
          projectPath={composerBridge?.projectPath ?? composerBridge?.cwd ?? ''}
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
  </>
}
