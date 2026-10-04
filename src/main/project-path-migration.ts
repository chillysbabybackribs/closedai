import { rewriteRetiredHostCheckoutPath } from '../shared/project-paths.js'
import type { AppSettings } from '../shared/types.js'
import type { AppSettingsStore } from './app-settings-store.js'
import type { ChatStore } from './chat-store/chat-store.js'

export function migrateRetiredHostCheckoutPaths(
  liveCheckout: string,
  settings: AppSettings,
  chatStore: ChatStore
): AppSettings {
  let next: AppSettings = { ...settings }
  let changed = false

  const workspacePath = rewriteRetiredHostCheckoutPath(next.chatWorkspacePath, liveCheckout)
  if (workspacePath !== next.chatWorkspacePath) {
    next = { ...next, chatWorkspacePath: workspacePath }
    changed = true
  }
  const projectPath = rewriteRetiredHostCheckoutPath(next.chatProjectPath, liveCheckout)
  if (projectPath !== next.chatProjectPath) {
    next = { ...next, chatProjectPath: projectPath }
    changed = true
  }

  const workspaces = next.chatWorkspaces.map((workspace) => {
    const cwd = rewriteRetiredHostCheckoutPath(workspace.cwd, liveCheckout) ?? workspace.cwd
    const mappedProject = rewriteRetiredHostCheckoutPath(workspace.projectPath, liveCheckout)
    if (cwd === workspace.cwd && mappedProject === workspace.projectPath) return workspace
    changed = true
    return { ...workspace, cwd, projectPath: mappedProject }
  })
  if (workspaces !== next.chatWorkspaces) next = { ...next, chatWorkspaces: workspaces }

  for (const id of chatStore.ids()) {
    const record = chatStore.require(id)
    const cwd = rewriteRetiredHostCheckoutPath(record.cwd, liveCheckout) ?? record.cwd
    const mappedProject = rewriteRetiredHostCheckoutPath(record.projectPath, liveCheckout)
    if (cwd === record.cwd && mappedProject === record.projectPath) continue
    chatStore.update(id, { cwd, projectPath: mappedProject })
    changed = true
  }

  return changed ? next : settings
}

export async function applyRetiredHostCheckoutMigration(
  liveCheckout: string,
  settingsStore: AppSettingsStore,
  chatStore: ChatStore
): Promise<void> {
  const current = settingsStore.get()
  const migrated = migrateRetiredHostCheckoutPaths(liveCheckout, current, chatStore)
  if (migrated !== current) await settingsStore.set(migrated)
}
