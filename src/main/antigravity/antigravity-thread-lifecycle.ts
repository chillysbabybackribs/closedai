import type { ChatEvent } from '../../shared/chat.js'
import { applyProviderRotation, type RotationSettingsAccess } from '../chat-context/rotate-provider-session.js'
import type { ContextUsage } from '../chat-context/context-compaction.js'
import type { SessionRotator } from '../chat-context/session-rotation.js'
import { ChatTranscript } from '../chat-transcript.js'
import type { AntigravityHistory } from './antigravity-history.js'
import type { AntigravitySession } from './antigravity-session.js'
import type { AntigravityToolBridge } from './antigravity-mcp.js'
import { antigravityThreadId } from './antigravity-ids.js'
import type { ChatSnapshot } from '../../shared/chat.js'

export type AntigravityThreadHost = {
  settings: RotationSettingsAccess
  paneId: string | null
  history: AntigravityHistory
  cwd: string
  bridge: AntigravityToolBridge
  transcript: ChatTranscript
  rotator: SessionRotator
  session(): AntigravitySession | null
  setSession(session: AntigravitySession | null): void
  createSession(): AntigravitySession
  threadName(): string | null
  setThreadName(name: string | null): void
  contextUsage(): ContextUsage | null
  setContextUsage(usage: ContextUsage | null): void
  setActiveTurnId(id: string | null): void
  snapshot(): ChatSnapshot
  emitEvent(event: ChatEvent): void
  addNotice(text: string, tone: 'info' | 'error', turnId: string | null): void
}

export async function resumeAntigravityConversation(host: AntigravityThreadHost, conversationId: string): Promise<void> {
  host.setContextUsage(null)
  host.rotator.reset()
  const items = await host.history.loadTranscript(conversationId)
  await host.session()!.adopt(conversationId)
  host.transcript.replaceItems(items ?? [])
  host.setThreadName(await host.history.threadName(conversationId).catch(() => null))
  await host.settings.set({ chatAntigravityConversationId: conversationId, chatContinuation: null })
  host.emitEvent({ type: 'replace', snapshot: host.snapshot() })
  if (!items) host.addNotice('Earlier messages of this chat were not recorded by ClosedAI; the conversation continues from where Antigravity left it.', 'info', null)
}

export async function detachAntigravityThread(host: AntigravityThreadHost): Promise<void> {
  const previous = host.session()?.conversationId ?? null
  await host.session()?.reset()
  if (previous) host.bridge.unbind(previous)
  host.transcript.clear()
  host.setThreadName(null)
  host.setActiveTurnId(null)
  host.setContextUsage(null)
  host.rotator.reset()
  await host.settings.set({ chatAntigravityConversationId: null })
}

export async function rotateAntigravityProviderSession(host: AntigravityThreadHost): Promise<void> {
  const usage = host.contextUsage()
  const conversationId = host.session()?.conversationId ?? null
  await applyProviderRotation(host.settings, {
    paneId: host.paneId,
    provider: 'antigravity',
    threadId: conversationId ? antigravityThreadId(conversationId) : null,
    threadName: host.threadName(),
    items: host.transcript.snapshot(),
    reason: host.rotator.rotationReason ?? 'manual'
  }, async () => {
    const previous = host.session()?.conversationId ?? null
    if (!host.session()) host.setSession(host.createSession())
    else await host.session()!.reset()
    if (previous) host.bridge.unbind(previous)
    host.setContextUsage(null)
    host.rotator.reset()
    await host.settings.set({ chatAntigravityConversationId: null })
    host.emitEvent({ type: 'thread', threadId: null, threadName: host.threadName() })
  }, usage)
}

export async function resumePersistedAntigravityConversation(host: AntigravityThreadHost): Promise<void> {
  const persisted = host.settings.get().chatAntigravityConversationId
  if (!persisted || host.session()?.conversationId) return
  try {
    await resumeAntigravityConversation(host, persisted)
  } catch (error) {
    const { messageOf } = await import('../chat-normalizers.js')
    console.warn('[antigravity] could not resume saved conversation:', messageOf(error))
    await detachAntigravityThread(host)
  }
}
