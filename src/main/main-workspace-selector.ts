import type { App } from 'electron'
import { appCheckoutPathOrNull } from './app-checkout.js'
import type { AppSettingsStore } from './app-settings-store.js'
import type { ChatStore } from './chat-store/chat-store.js'

export function sameChatWorkspace(
  left: { cwd: string; projectPath: string | null },
  right: { cwd: string; projectPath: string | null }
): boolean {
  return left.cwd === right.cwd && left.projectPath === right.projectPath
}

export type ChatWorkspaceSelector = {
  current: () => {
    cwd: string
    projectPath: string | null
    appCheckoutPath: string
    recentProjects: Array<{ cwd: string; projectPath: string }>
  }
  select: (
    nextProjectPath: string | null,
    preference: { modelId: string | null; reasoningEffort: string | null }
  ) => Promise<void>
}

export function createChatWorkspaceSelector(deps: {
  app: App
  settings: AppSettingsStore
  chatStore: ChatStore
  getWorkspace: () => { cwd: string; projectPath: string | null }
  setWorkspace: (cwd: string, projectPath: string | null) => void
}): ChatWorkspaceSelector {
  return {
    current: () => {
      const { cwd, projectPath } = deps.getWorkspace()
      return {
        cwd,
        projectPath,
        appCheckoutPath: appCheckoutPathOrNull() ?? deps.app.getAppPath(),
        recentProjects: [...deps.settings.get().chatWorkspaces]
          .reverse()
          .filter((workspace) => workspace.projectPath && !sameChatWorkspace(workspace, { cwd, projectPath }))
          .map((workspace) => ({ cwd: workspace.cwd, projectPath: workspace.projectPath! }))
      }
    },
    select: async (nextProjectPath, preference) => {
      const current = deps.settings.get()
      const previous = {
        cwd: deps.getWorkspace().cwd,
        projectPath: deps.getWorkspace().projectPath,
        openIds: current.chatOpenIds,
        peers: [],
        selectedPaneId: current.chatSelectedPaneId
      }
      const nextCwd = nextProjectPath ?? deps.app.getPath('home')
      const saved = current.chatWorkspaces.filter((workspace) => !sameChatWorkspace(workspace, previous))
      const destination = saved.find((workspace) =>
        workspace.cwd === nextCwd && workspace.projectPath === nextProjectPath
      )
      const destinationOpenIds = (destination?.openIds ?? []).filter((id) => deps.chatStore.has(id))
      const destinationSelected = destination?.selectedPaneId && destinationOpenIds.includes(destination.selectedPaneId)
        ? destination.selectedPaneId
        : destinationOpenIds[0] ?? null
      const destinationChat = destinationSelected ? deps.chatStore.get(destinationSelected) ?? null : null
      await deps.settings.set({
        chatWorkspaces: [...saved, previous],
        chatWorkspacePath: nextCwd,
        chatProjectPath: nextProjectPath,
        chatOpenIds: destinationOpenIds,
        chatSelectedPaneId: destinationSelected,
        chatThreadId: destinationChat?.codexThreadId ?? null,
        chatClaudeSessionId: destinationChat?.claudeSessionId ?? null,
        chatAntigravityConversationId: destinationChat?.antigravityConversationId ?? null,
        chatCursorSessionId: destinationChat?.cursorSessionId ?? null,
        chatModelId: destinationChat?.modelId ?? preference.modelId,
        chatReasoningEffort: destinationChat?.reasoningEffort ?? preference.reasoningEffort,
        chatContinuation: destinationChat?.continuation ?? null
      })
      deps.setWorkspace(nextCwd, nextProjectPath)
    }
  }
}
