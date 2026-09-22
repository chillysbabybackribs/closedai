import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react'

import type { useChatController } from '../chat-controller.js'
import { usePaneChatController } from '../chat-controller.js'
import type { AgentSoloControls } from '../chat-layout/chat-canvas.js'
import { AGENT_WORKSPACE_PANE_ID, CHAT_DRAG_TYPE } from '../chat-layout/layout-tree.js'
import { chatRunning } from '../chat-state.js'
import { ProjectWorkspace, type ProjectWorkspaceComposerBridge } from './project-workspace.js'

import type { AppearanceSettings } from '../settings/appearance-settings.js'

export function AgentWorkspacePane({ controls, busy, chat, appearance }: {
  controls: AgentSoloControls
  busy: boolean
  chat: ReturnType<typeof useChatController>
  appearance: AppearanceSettings
}) {
  const [agentPaneId, setAgentPaneId] = useState<string | null>(null)
  const creating = useRef(false)
  const restarting = useRef(false)
  useEffect(() => {
    if (agentPaneId || creating.current) return
    const saved = window.localStorage.getItem('closedai.agentWorkspacePaneId')
    if (saved && chat.snapshot.panes?.[saved]) {
      setAgentPaneId(saved)
      return
    }
    creating.current = true
    void chat.newDetachedThread().then((paneId) => {
      window.localStorage.setItem('closedai.agentWorkspacePaneId', paneId)
      setAgentPaneId(paneId)
    }).finally(() => { creating.current = false })
  }, [agentPaneId, chat.chats, chat.newDetachedThread, chat.snapshot.panes])

  const bridgePaneId = agentPaneId
  const bridgeState = bridgePaneId
    ? (chat.snapshot.panes?.[bridgePaneId] ?? null)
    : null
  const agentChat = usePaneChatController(
    chat.snapshot,
    bridgePaneId ?? chat.selectedPaneId,
    bridgeState ?? chat.snapshot.selected,
    chat.dispatch
  )

  const record = bridgePaneId ? chat.chats.find((row) => row.paneId === bridgePaneId) : undefined
  const project = record?.pendingProject ?? {
    cwd: record?.cwd ?? chat.state.cwd,
    projectPath: record?.projectPath === undefined ? chat.state.cwd : record.projectPath
  }
  const recentProjects = [...new Map([
    ...(chat.workspace?.recentProjects ?? []),
    ...chat.chats.filter((row) => row.projectPath).map((row) => ({ cwd: row.cwd, projectPath: row.projectPath! }))
  ].map((entry) => [entry.projectPath, entry])).values()].filter((entry) => entry.projectPath !== project.projectPath)
  const persistedPath = project.projectPath ?? project.cwd

  // Reset the project store to a blank intake, then close the coordinator chat backing this
  // workspace and let the effect above stand up a fresh one; the pane below remounts on the new
  // pane id and hydrates the reset file. The closed chat stays in history.
  const restart = useCallback(() => {
    if (restarting.current || !agentPaneId) return
    restarting.current = true
    const closing = agentPaneId
    window.localStorage.removeItem('closedai.agentWorkspacePaneId')
    setAgentPaneId(null)
    void window.closedai.project.mutate(persistedPath, [{ type: 'reset' }])
      .catch((error: unknown) => console.warn('[agent-workspace] project reset failed:', error))
      .then(() => chat.closePeer(closing))
      .finally(() => { restarting.current = false })
  }, [agentPaneId, chat.closePeer, persistedPath])

  const bridge: ProjectWorkspaceComposerBridge | null = bridgePaneId && bridgeState ? {
    items: bridgeState.items,
    models: bridgeState.models,
    selectedModel: bridgeState.selectedModel,
    selectedReasoningEffort: bridgeState.selectedReasoningEffort,
    contextUsage: bridgeState.contextUsage,
    provider: bridgeState.provider,
    planUsage: bridgeState.planUsage,
    onRefreshPlanUsage: agentChat.refreshPlanUsage,
    onModelChange: agentChat.selectModel,
    onReasoningEffortChange: agentChat.selectReasoningEffort,
    cwd: project.cwd,
    projectPath: project.projectPath,
    projectPending: Boolean(record?.pendingProject),
    recentProjects,
    onChooseProject: () => window.closedai.chat.chooseProject(bridgePaneId),
    onSelectProject: (projectPath) => window.closedai.chat.selectProject(bridgePaneId, projectPath),
    onClearProject: () => window.closedai.chat.clearProject(bridgePaneId),
    activeTurnId: bridgeState.activeTurnId,
    pausedTurnId: bridgeState.pausedTurnId,
    running: chatRunning(bridgeState),
    paused: bridgeState.pausedTurnId !== null,
    onStop: agentChat.interrupt,
    onResume: async () => agentChat.resumePane(bridgePaneId),
    onSend: async (text) => { await agentChat.send(text, []) }
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
      <button type="button" className="agent-workspace-restart" data-ui="layout.agent-restart"
        disabled={busy || !agentPaneId} aria-label="Restart agent workspace"
        title="Close this coordinator chat and start a fresh discovery"
        onClick={restart}>
        <RotateCcw size={14} aria-hidden="true" />
      </button>
      <button type="button" className="agent-workspace-solo" data-ui="layout.agent-full-view"
        aria-pressed={controls.solo} aria-label={controls.solo ? 'Exit full view' : 'Full view'}
        title={controls.solo ? 'Exit full view (Esc)' : 'Full view'}
        onClick={controls.toggleSolo}>
        {controls.solo ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
      </button>
    </div>
    {bridgePaneId && bridgeState
      ? <ProjectWorkspace
          key={bridgePaneId}
          paneId={bridgePaneId}
          embedded
          fixedComposerLayout="compact"
          composerBridge={bridge}
          chatAppearance={{
            zoom: appearance.chatZoom,
            fontSize: appearance.chatFontSize,
            composerFontSize: appearance.composerFontSize
          }}
          projectPath={persistedPath}
        />
      : <div className="agent-workspace-loading">Starting agent workspace…</div>}
  </div>
}
