import type { App } from 'electron'
import { ChatHub } from './chat-hub.js'
import { ChatService } from './chat-service.js'
import { CodexWorkspaceRuntime } from './codex-workspace-runtime.js'
import { ClaudeChatService } from './claude/claude-service.js'
import { AntigravityChatService } from './antigravity/antigravity-service.js'
import { CursorChatService } from './cursor/cursor-service.js'
import type { AntigravityToolBridge } from './antigravity/antigravity-mcp.js'
import type { CursorToolBridge } from './cursor/cursor-mcp.js'
import type { WorkspaceCatalogs } from './chat-context/provider-catalog-cache.js'
import type { ToolRegistry } from './tools/registry.js'
import type { ScreenshotStore } from './tools/capture/screenshot-store.js'
import type { ActiveBrowserContext, TurnSurfaceContext } from './chat-context/turn-context.js'
import type { AppSettingsStore } from './app-settings-store.js'
import type { ChatStore } from './chat-store/chat-store.js'
import type { ChatRecord } from '../shared/chat-store.js'
import type { PeerSettings } from './chat-peers/peer-settings.js'

export function createPaneChatHub(deps: {
  app: App
  settings: AppSettingsStore
  chatStore: ChatStore
  codexRuntimes: Map<string, CodexWorkspaceRuntime>
  toolRegistry: ToolRegistry
  screenshots: ScreenshotStore
  activeBrowserContext: () => ActiveBrowserContext | null
  /** A notepad window's chat works over its note instead of the browser tab. */
  notepadContext: (paneId: string) => TurnSurfaceContext | null
  antigravityBridge: AntigravityToolBridge
  antigravityStateDir: string
  cursorBridge: CursorToolBridge
  cursorStateDir: string
  peerSettings: PeerSettings
  record: ChatRecord
  catalogs: WorkspaceCatalogs
}): ChatHub {
  let codexRuntime = deps.codexRuntimes.get(deps.record.cwd)
  if (!codexRuntime) {
    codexRuntime = new CodexWorkspaceRuntime(deps.record.cwd, deps.settings, { clientVersion: deps.app.getVersion() })
    deps.codexRuntimes.set(deps.record.cwd, codexRuntime)
  }
  const surfaceContext = (): TurnSurfaceContext | null =>
    deps.notepadContext(deps.peerSettings.paneId) ?? deps.activeBrowserContext()
  return new ChatHub({
    codex: new ChatService(
      deps.record.cwd, deps.peerSettings, deps.toolRegistry, surfaceContext, deps.screenshots, codexRuntime, deps.peerSettings.paneId
    ),
    claude: new ClaudeChatService(
      deps.record.cwd, deps.peerSettings, deps.toolRegistry, surfaceContext, deps.screenshots, deps.peerSettings.paneId
    ),
    antigravity: new AntigravityChatService(
      deps.record.cwd, deps.peerSettings, deps.antigravityBridge, deps.antigravityStateDir, surfaceContext, deps.screenshots, deps.peerSettings.paneId, deps.catalogs
    ),
    cursor: new CursorChatService(
      deps.record.cwd, deps.peerSettings, deps.cursorBridge, deps.cursorStateDir, surfaceContext, deps.screenshots, deps.peerSettings.paneId, deps.catalogs
    )
  }, deps.record.modelId, deps.peerSettings, {
    provider: deps.record.provider,
    catalogs: deps.catalogs,
    checkpoint: () => deps.chatStore.get(deps.peerSettings.paneId)?.checkpoint ?? null
  })
}
