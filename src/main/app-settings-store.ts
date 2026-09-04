import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { writeAtomic } from './atomic-write.js'
import type { ChatProvider } from '../shared/chat.js'
import type { AppSettings, ChatContinuation, ChatPeerRecord, ChatWorkspaceRecord } from '../shared/types.ts'
import { bareChatId, chatProviderOfId, isChatProvider } from '../shared/chat-providers.js'
import { peerThreadId } from './chat-peers/peer-settings.js'
import { DEFAULT_BATCH_MAX_CALLS, normalizeBatchMaxCalls } from './batch-config.js'
import { normalizeMemoryCheckpoint } from './chat-context/memory-checkpoint.js'

export type AppSettingsAccess = {
  get(): AppSettings
  set(patch: Partial<AppSettings>): Promise<AppSettings>
}

// App-scoped preferences that must live in the main process because they shape how
// the Codex app-server is driven (see codex-client thread/start + thread/resume).
// Kept deliberately tiny: one flat JSON object, no debouncing or retention — settings
// change rarely and each write is a single small object, so a plain atomic write per
// change is simpler than the machinery ChatHistoryStore needs for a hot append path.

export const DEFAULT_APP_SETTINGS: AppSettings = {
  // Cookies from the user's real browser have not been imported yet; the first
  // successful import flips this so it happens exactly once.
  browserCookiesImported: false,
  chatWorkspacePath: null,
  chatProjectPath: null,
  chatWorkspaces: [],
  chatThreadId: null,
  chatClaudeSessionId: null,
  chatAntigravityConversationId: null,
  chatCursorSessionId: null,
  chatModelId: null,
  chatReasoningEffort: null,
  chatContinuation: null,
  chatPeers: [],
  chatSelectedPaneId: null,
  disabledTools: [],
  toolBatchMaxCalls: DEFAULT_BATCH_MAX_CALLS,
  // Preserve existing behavior until the optional smaller budget is evaluated against
  // first-text timing and recall. Cached input size alone does not establish latency.
  chatCompactAtPercent: 80,
  chatCompactAtTokens: 0,
  chatMidTurnCompactTokens: 0
}

const MAX_COMPACT_AT_PERCENT = 95
const MIN_AUTO_COMPACT_TOKENS = 20_000
const MAX_AUTO_COMPACT_TOKENS = 2_000_000

function normalize(parsed: unknown): AppSettings {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_APP_SETTINGS }
  const record = parsed as Record<string, unknown>
  const chatModelId = optionalString(record.chatModelId)
  const chatReasoningEffort = optionalString(record.chatReasoningEffort)
  const chatPeers = normalizeChatPeers(record.chatPeers, {
    chatThreadId: optionalString(record.chatThreadId),
    chatClaudeSessionId: optionalString(record.chatClaudeSessionId),
    chatAntigravityConversationId: optionalString(record.chatAntigravityConversationId),
    chatCursorSessionId: optionalString(record.chatCursorSessionId),
    chatModelId,
    chatReasoningEffort
  })
  const requestedPaneId = optionalString(record.chatSelectedPaneId)
  const chatSelectedPaneId = chatPeers.some((peer) => peer.paneId === requestedPaneId)
    ? requestedPaneId
    : chatPeers[0]?.paneId ?? null
  return {
    browserCookiesImported:
      typeof record.browserCookiesImported === 'boolean'
        ? record.browserCookiesImported
        : DEFAULT_APP_SETTINGS.browserCookiesImported,
    chatWorkspacePath: optionalString(record.chatWorkspacePath),
    chatProjectPath: optionalString(record.chatProjectPath),
    chatWorkspaces: normalizeChatWorkspaces(record.chatWorkspaces),
    chatThreadId: optionalString(record.chatThreadId),
    chatClaudeSessionId: optionalString(record.chatClaudeSessionId),
    chatAntigravityConversationId: optionalString(record.chatAntigravityConversationId),
    chatCursorSessionId: optionalString(record.chatCursorSessionId),
    chatModelId,
    chatReasoningEffort,
    chatContinuation: normalizeContinuation(record.chatContinuation),
    chatPeers,
    chatSelectedPaneId,
    disabledTools: Array.isArray(record.disabledTools)
      ? [...new Set(record.disabledTools.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : [],
    toolBatchMaxCalls: normalizeBatchMaxCalls(record.toolBatchMaxCalls),
    chatCompactAtPercent: typeof record.chatCompactAtPercent === 'number' && Number.isFinite(record.chatCompactAtPercent)
      ? Math.min(MAX_COMPACT_AT_PERCENT, Math.max(0, Math.round(record.chatCompactAtPercent)))
      : DEFAULT_APP_SETTINGS.chatCompactAtPercent,
    chatCompactAtTokens: normalizeAutoCompactTokens(record.chatCompactAtTokens),
    chatMidTurnCompactTokens: normalizeAutoCompactTokens(record.chatMidTurnCompactTokens)
  }
}

/** Title and last-activity time are optional on older records; absent keys stay absent. */
function peerDisplayFields(record: Record<string, unknown>): Pick<ChatPeerRecord, 'title' | 'updatedAt'> {
  const title = optionalString(record.title)
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) && record.updatedAt > 0
    ? Math.floor(record.updatedAt)
    : null
  return { ...(title ? { title } : {}), ...(updatedAt ? { updatedAt } : {}) }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeChatPeers(
  value: unknown,
  legacy: Pick<AppSettings, 'chatThreadId' | 'chatClaudeSessionId' | 'chatAntigravityConversationId' | 'chatCursorSessionId' | 'chatModelId' | 'chatReasoningEffort'>
): ChatPeerRecord[] {
  if (Array.isArray(value)) {
    const seen = new Set<string>()
    const peers = value.flatMap((candidate): ChatPeerRecord[] => {
      if (!candidate || typeof candidate !== 'object') return []
      const record = candidate as Record<string, unknown>
      const paneId = optionalString(record.paneId)
      if (!paneId || seen.has(paneId)) return []
      seen.add(paneId)
      const modelId = optionalString(record.modelId)
      const provider = isChatProvider(record.provider) ? record.provider : chatProviderOfId(modelId)
      const threadId = optionalString(record.threadId)
      // Records written before a provider had its own field carry that thread only in `threadId`,
      // which is the prefixed form; an id saved bare by an even older build is kept as it stands.
      const legacy = (owner: ChatProvider): string | null =>
        provider === owner ? bareChatId(owner, threadId) ?? threadId : null
      const ids = {
        codexThreadId: optionalString(record.codexThreadId) ?? legacy('codex'),
        claudeSessionId: optionalString(record.claudeSessionId) ?? legacy('claude'),
        antigravityConversationId: optionalString(record.antigravityConversationId) ?? legacy('antigravity'),
        cursorSessionId: optionalString(record.cursorSessionId) ?? legacy('cursor')
      }
      return [{
        paneId,
        provider,
        threadId: peerThreadId(provider, ids),
        ...ids,
        modelId,
        reasoningEffort: optionalString(record.reasoningEffort),
        continuation: normalizeContinuation(record.continuation),
        ...(record.checkpoint !== undefined ? { checkpoint: normalizeMemoryCheckpoint(record.checkpoint) } : {}),
        ...peerDisplayFields(record)
      }]
    })
    if (peers.length > 0) return peers
  }
  const provider = chatProviderOfId(legacy.chatModelId)
  const ids = {
    codexThreadId: legacy.chatThreadId,
    claudeSessionId: legacy.chatClaudeSessionId,
    antigravityConversationId: legacy.chatAntigravityConversationId,
    cursorSessionId: legacy.chatCursorSessionId
  }
  return [{
    paneId: randomUUID(),
    provider,
    threadId: peerThreadId(provider, ids),
    ...ids,
    modelId: legacy.chatModelId,
    reasoningEffort: legacy.chatReasoningEffort,
    continuation: null
  }]
}

function normalizeChatWorkspaces(value: unknown): ChatWorkspaceRecord[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((candidate): ChatWorkspaceRecord[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const record = candidate as Record<string, unknown>
    const cwd = optionalString(record.cwd)
    if (!cwd) return []
    const projectPath = optionalString(record.projectPath)
    const key = workspaceKey(cwd, projectPath)
    if (seen.has(key)) return []
    if (!Array.isArray(record.peers) || record.peers.length === 0) return []
    const peers = normalizeChatPeers(record.peers, {
      chatThreadId: null,
      chatClaudeSessionId: null,
      chatAntigravityConversationId: null,
      chatCursorSessionId: null,
      chatModelId: null,
      chatReasoningEffort: null
    })
    if (peers.length === 0) return []
    seen.add(key)
    const selectedPaneId = optionalString(record.selectedPaneId)
    return [{
      cwd,
      projectPath,
      peers,
      selectedPaneId: peers.some((peer) => peer.paneId === selectedPaneId) ? selectedPaneId : peers[0]!.paneId
    }]
  })
}

function workspaceKey(cwd: string, projectPath: string | null): string {
  return `${projectPath === null ? 'none' : 'project'}:${cwd}`
}

function normalizeContinuation(value: unknown): ChatContinuation | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isChatProvider(record.sourceProvider) || typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return null
  const sourcePaneId = optionalString(record.sourcePaneId)
  const sourceThreadId = optionalString(record.sourceThreadId)
  if (!sourcePaneId && !sourceThreadId) return null
  return {
    sourcePaneId,
    sourceThreadId,
    sourceProvider: record.sourceProvider,
    sourceTitle: typeof record.sourceTitle === 'string' ? record.sourceTitle : '',
    handoff: optionalString(record.handoff),
    createdAt: record.createdAt,
    ...(record.sourceThroughItemId !== undefined ? { sourceThroughItemId: optionalString(record.sourceThroughItemId) } : {}),
    ...(record.checkpoint !== undefined ? { checkpoint: normalizeMemoryCheckpoint(record.checkpoint) } : {})
  }
}

/** 0 disables; anything else lands between the bounds so a typo cannot compact every call. */
function normalizeAutoCompactTokens(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_APP_SETTINGS.chatMidTurnCompactTokens
  if (value <= 0) return 0
  return Math.min(MAX_AUTO_COMPACT_TOKENS, Math.max(MIN_AUTO_COMPACT_TOKENS, Math.round(value)))
}

export class AppSettingsStore {
  private constructor(
    private readonly filePath: string,
    private settings: AppSettings
  ) {}

  static async open(filePath: string): Promise<AppSettingsStore> {
    let settings: AppSettings = { ...DEFAULT_APP_SETTINGS }
    try {
      settings = normalize(JSON.parse(await readFile(filePath, 'utf8')))
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      // A missing file is the first-run case; a malformed file falls back to defaults
      // rather than crashing startup. Either way the next write lays down clean JSON.
      if (code !== 'ENOENT') console.warn('app settings unreadable, using defaults:', messageOf(error))
    }
    return new AppSettingsStore(filePath, settings)
  }

  get(): AppSettings {
    return { ...this.settings }
  }

  // Merge a partial patch, persist, and return the full resolved settings. Returns the
  // new state so the caller can react (e.g. re-resume threads) without a second read.
  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = normalize({ ...this.settings, ...patch })
    await writeAtomic(this.filePath, `${JSON.stringify(this.settings, null, 2)}\n`)
    return this.get()
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
