import type { ChatEvent, ChatSnapshot } from '../../shared/chat.js'
import { applyProviderRotation, type RotationSettingsAccess } from '../chat-context/rotate-provider-session.js'
import type { SessionRotator } from '../chat-context/session-rotation.js'
import { messageOf } from '../chat-normalizers.js'
import { ChatTranscript } from '../chat-transcript.js'
import type { CursorSession } from './cursor-session.js'
import { cursorThreadId } from './cursor-ids.js'

export type CursorThreadHost = {
  settings: RotationSettingsAccess
  paneId: string | null
  transcript: ChatTranscript
  rotator: SessionRotator
  session(): CursorSession | null
  threadName(): string | null
  setThreadName(name: string | null): void
  setActiveTurnId(id: string | null): void
  transcriptEmpty(): boolean
  activeTurnId(): string | null
  snapshot(): ChatSnapshot
  emitEvent(event: ChatEvent): void
}

export async function resumeCursorSession(host: CursorThreadHost, session: CursorSession, sessionId: string): Promise<void> {
  const items = await session.replay(sessionId)
  session.continueWith(sessionId)
  host.transcript.replaceItems(items)
  host.setThreadName(null)
  await host.settings.set({ chatCursorSessionId: sessionId, chatContinuation: null })
  host.emitEvent({ type: 'replace', snapshot: host.snapshot() })
}

export async function resumePersistedCursorSession(host: CursorThreadHost, session: CursorSession): Promise<void> {
  const persisted = host.settings.get().chatCursorSessionId
  if (!persisted || !host.transcriptEmpty() || host.activeTurnId()) return
  try {
    await resumeCursorSession(host, session, persisted)
  } catch (error) {
    console.warn('[cursor] could not resume the saved session:', messageOf(error))
    await detachCursorThread(host, session)
  }
}

export async function detachCursorThread(host: CursorThreadHost, session: CursorSession | null): Promise<void> {
  await session?.reset()
  host.transcript.clear()
  host.setThreadName(null)
  host.setActiveTurnId(null)
  host.rotator.reset()
  await host.settings.set({ chatCursorSessionId: null })
}

export async function rotateCursorProviderSession(host: CursorThreadHost, session: CursorSession | null): Promise<void> {
  await applyProviderRotation(host.settings, {
    paneId: host.paneId,
    provider: 'cursor',
    threadId: session?.sessionId ? cursorThreadId(session.sessionId) : null,
    threadName: host.threadName(),
    items: host.transcript.snapshot()
  }, async () => {
    await session?.reset()
    host.rotator.reset()
    await host.settings.set({ chatCursorSessionId: null })
    host.emitEvent({ type: 'thread', threadId: null, threadName: host.threadName() })
  }, null)
}
