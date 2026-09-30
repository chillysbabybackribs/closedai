import type { ChatEvent, ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
import type { ContextUsage } from '../chat-context/context-compaction.js'
import { applyProviderRotation, type RotationSettingsAccess } from '../chat-context/rotate-provider-session.js'
import type { SessionRotator } from '../chat-context/session-rotation.js'
import { messageOf } from '../chat-normalizers.js'
import { ChatTranscript } from '../chat-transcript.js'
import type { ScreenshotStore } from '../tools/capture/screenshot-store.js'
import { claudeThreadName, replayClaudeSession } from './claude-history.js'
import { claudeSessionIdOf, claudeThreadId } from './claude-ids.js'
import type { ClaudeSdk } from './claude-sdk.js'
import type { ClaudeSession } from './claude-session.js'

export const CLAUDE_THREAD_CACHE_LIMIT = 8

export type ClaudeThreadHost = {
  cwd: string
  settings: RotationSettingsAccess
  paneId: string | null
  sdk: () => ClaudeSdk | null
  setSdk: (sdk: ClaudeSdk) => void
  session: () => ClaudeSession | null
  transcript: ChatTranscript
  rotator: SessionRotator
  threadCache: Map<string, ChatThreadContent>
  liveSessionId: () => string | null
  threadName: () => string | null
  setThreadName: (name: string | null) => void
  contextUsage: () => ContextUsage | null
  setContextUsage: (usage: ContextUsage | null) => void
  setActiveTurnId: (id: string | null) => void
  ensureConnected: () => Promise<void>
  snapshot: () => ChatSnapshot
  emitEvent: (event: ChatEvent) => void
  screenshots: Pick<ScreenshotStore, 'get'> | null
  readThreadPrefetch: (threadId: string) => Promise<void>
}

export function rememberClaudeThreadCache(host: ClaudeThreadHost, threadId: string, content: ChatThreadContent): void {
  host.threadCache.delete(threadId)
  host.threadCache.set(threadId, content)
  if (host.threadCache.size <= CLAUDE_THREAD_CACHE_LIMIT) return
  const oldest = host.threadCache.keys().next().value
  if (oldest !== undefined) host.threadCache.delete(oldest)
}

export async function readCachedClaudeThread(host: ClaudeThreadHost, threadId: string, cwd = host.cwd): Promise<ChatThreadContent> {
  const sessionId = claudeSessionIdOf(threadId)
  if (!sessionId) throw new Error('Invalid Claude thread')
  const live = sessionId === host.liveSessionId()
  if (!live) {
    const cached = host.threadCache.get(threadId)
    if (cached) return cached
  }
  await host.ensureConnected()
  const sdk = host.sdk()
  if (!sdk) throw new Error('Claude SDK is not available')
  const items = await replayClaudeSession(sdk, sessionId, {
    cwd,
    displayScreenshot: (callId) => host.screenshots?.get(callId) ?? null
  })
  const threadName = await claudeThreadName(sdk, sessionId, cwd).catch(() => null)
  const content: ChatThreadContent = { threadId, threadName, items }
  if (!live && sessionId !== host.liveSessionId()) rememberClaudeThreadCache(host, threadId, content)
  return content
}

export async function resumeClaudeSession(host: ClaudeThreadHost, session: ClaudeSession, sessionId: string): Promise<void> {
  host.threadCache.delete(claudeThreadId(sessionId))
  const sdk = host.sdk()
  if (!sdk) throw new Error('Claude SDK is not available')
  const items = await replayClaudeSession(sdk, sessionId, {
    cwd: host.cwd,
    displayScreenshot: (callId) => host.screenshots?.get(callId) ?? null
  })
  await session.adopt(sessionId)
  host.transcript.replaceItems(items)
  host.setContextUsage(null)
  host.setThreadName(await claudeThreadName(sdk, sessionId, host.cwd).catch(() => null))
  await host.settings.set({ chatClaudeSessionId: sessionId, chatContinuation: null })
  host.emitEvent({ type: 'replace', snapshot: host.snapshot() })
}

export async function resumePersistedClaudeSession(host: ClaudeThreadHost, session: ClaudeSession): Promise<void> {
  const persisted = host.settings.get().chatClaudeSessionId
  if (!persisted || session.sessionId) return
  try {
    await resumeClaudeSession(host, session, persisted)
  } catch (error) {
    console.warn('[claude] could not resume saved session:', messageOf(error))
    await detachClaudeThread(host, session)
  }
}

export async function detachClaudeThread(host: ClaudeThreadHost, session: ClaudeSession | null): Promise<void> {
  await session?.reset()
  host.transcript.clear()
  host.setThreadName(null)
  host.setContextUsage(null)
  host.rotator.reset()
  host.setActiveTurnId(null)
  await host.settings.set({ chatClaudeSessionId: null })
}

export async function rotateClaudeProviderSession(host: ClaudeThreadHost, session: ClaudeSession | null): Promise<void> {
  try {
    await applyProviderRotation(host.settings, {
      paneId: host.paneId,
      provider: 'claude',
      threadId: session?.sessionId ? claudeThreadId(session.sessionId) : null,
      threadName: host.threadName(),
      items: host.transcript.snapshot(),
      reason: host.rotator.rotationReason ?? 'manual'
    }, async () => {
      await session?.reset()
      host.setContextUsage(null)
      host.rotator.reset()
      await host.settings.set({ chatClaudeSessionId: null })
      host.emitEvent({ type: 'thread', threadId: null, threadName: host.threadName() })
    }, host.contextUsage(), {
      prefetchSource: (threadId) => { void host.readThreadPrefetch(threadId) }
    })
  } finally {
    host.rotator.complete()
  }
}
