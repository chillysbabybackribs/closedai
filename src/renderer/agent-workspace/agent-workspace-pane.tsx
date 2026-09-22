import { Maximize2, Minimize2 } from 'lucide-react'

import type { useChatController } from '../chat-controller.js'
import type { AgentSoloControls } from '../chat-layout/chat-canvas.js'
import { AGENT_WORKSPACE_PANE_ID, CHAT_DRAG_TYPE } from '../chat-layout/layout-tree.js'
import { ProjectWorkspace, type ProjectWorkspaceComposerBridge } from './project-workspace.js'

export function AgentWorkspacePane({ controls, busy, chat }: {
  controls: AgentSoloControls
  busy: boolean
  chat: ReturnType<typeof useChatController>
}) {
  const bridgePaneId = chat.selectedPaneId
  const bridgeState = bridgePaneId
    ? (chat.snapshot.panes?.[bridgePaneId] ?? (chat.snapshot.selectedPaneId === bridgePaneId ? chat.snapshot.selected : null))
    : null
  const record = bridgePaneId ? chat.chats.find((row) => row.paneId === bridgePaneId) : undefined
  const project = record?.pendingProject ?? {
    cwd: record?.cwd ?? chat.state.cwd,
    projectPath: record?.projectPath === undefined ? chat.state.cwd : record.projectPath
  }
  const recentProjects = [...new Map([
    ...(chat.workspace?.recentProjects ?? []),
    ...chat.chats.filter((row) => row.projectPath).map((row) => ({ cwd: row.cwd, projectPath: row.projectPath! }))
  ].map((entry) => [entry.projectPath, entry])).values()].filter((entry) => entry.projectPath !== project.projectPath)
  const bridge: ProjectWorkspaceComposerBridge | null = bridgePaneId && bridgeState ? {
    models: bridgeState.models,
    selectedModel: bridgeState.selectedModel,
    selectedReasoningEffort: bridgeState.selectedReasoningEffort,
    contextUsage: bridgeState.contextUsage,
    provider: bridgeState.provider,
    planUsage: bridgeState.planUsage,
    onRefreshPlanUsage: chat.refreshPlanUsage,
    onModelChange: chat.selectModel,
    onReasoningEffortChange: chat.selectReasoningEffort,
    cwd: project.cwd,
    projectPath: project.projectPath,
    projectPending: Boolean(record?.pendingProject),
    recentProjects,
    onChooseProject: () => window.closedai.chat.chooseProject(bridgePaneId),
    onSelectProject: (projectPath) => window.closedai.chat.selectProject(bridgePaneId, projectPath),
    onClearProject: () => window.closedai.chat.clearProject(bridgePaneId),
    activeTurnId: bridgeState.activeTurnId
  } : null

  return <div className="agent-workspace-pane">
    <div className="agent-workspace-layout-bar">
      <button type="button" className="agent-workspace-drag chat-layout-drag" data-ui="layout.agent-drag"
        draggable={!busy} disabled={busy} aria-label="Move agent workspace"
        title="Drag to stack or dock beside a chat"
        onDragStart={(event) => {
          event.dataTransfer.setData(CHAT_DRAG_TYPE, AGENT_WORKSPACE_PANE_ID)
          event.dataTransfer.effectAllowed = 'move'
        }}>
        <span className="chat-layout-drag-dots" aria-hidden="true" />
      </button>
      <button type="button" className="agent-workspace-solo" data-ui="layout.agent-full-view"
        aria-pressed={controls.solo} aria-label={controls.solo ? 'Exit full view' : 'Full view'}
        title={controls.solo ? 'Exit full view (Esc)' : 'Full view'}
        onClick={controls.toggleSolo}>
        {controls.solo ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
      </button>
    </div>
    <ProjectWorkspace paneId={AGENT_WORKSPACE_PANE_ID} embedded fixedComposerLayout="compact" composerBridge={bridge} />
  </div>
}
