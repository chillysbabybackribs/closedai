import type { ChatMemoryCheckpoint, ChatRecallRequest, ChatRecallResult } from '../../shared/chat-memory.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { validateMemoryState } from './memory-checkpoint.js'
import { recallTranscript } from './memory-recall.js'

export type MemoryCaller = { paneId?: string | null; threadId: string | null; turnId: string | null; signal?: AbortSignal }
type MemorySurface = Pick<ChatSurface, 'snapshot' | 'readThread'>

/** One app-owned checkpoint per pane; transcripts stay in their existing provider stores. */
export class ChatMemory {
  constructor(private readonly settings: AppSettingsAccess, private readonly surface: (paneId: string) => MemorySurface | null) {}

  async save(caller: MemoryCaller, expectedRevision: number, state: unknown): Promise<ChatMemoryCheckpoint> {
    const { pane, surface } = this.resolve(caller)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER
      || caller.threadId!.length > 256) throw new Error('Invalid checkpoint revision or thread id')
    if (!caller.turnId || surface.snapshot({ limit: 0 }).activeTurnId !== caller.turnId) throw new Error('Checkpoint requires the caller’s active turn')
    const current = pane.checkpoint?.threadId === caller.threadId ? pane.checkpoint : null
    if (expectedRevision !== (current?.revision ?? 0)) throw new Error('Checkpoint revision changed; recall current memory before replacing it')
    const throughItemId = surface.snapshot({ limit: 1 }).items.at(-1)?.id
    if (!throughItemId || throughItemId.length > 256) throw new Error('No stable transcript boundary is available')
    const checkpoint: ChatMemoryCheckpoint = {
      version: 1, revision: (current?.revision ?? 0) + 1, threadId: caller.threadId!,
      throughItemId, createdAt: Date.now(), state: validateMemoryState(state)
    }
    // No await between scope/revision validation and the synchronous settings update.
    await this.settings.set({ chatPeers: this.settings.get().chatPeers.map((entry) => entry.paneId === pane.paneId
      ? { ...entry, checkpoint } : entry) })
    if (this.resolve(caller).surface !== surface) throw new Error('Chat changed while saving memory')
    return checkpoint
  }

  async recall(caller: MemoryCaller, request: ChatRecallRequest): Promise<ChatRecallResult> {
    const { pane, surface } = this.resolve(caller)
    if (request.scope === 'current') {
      const snapshot = surface.snapshot()
      const checkpoint = pane.checkpoint?.threadId === caller.threadId ? pane.checkpoint : null
      return recallTranscript(snapshot.items, caller.threadId!, checkpoint, request, null)
    }
    if (request.scope !== 'source') throw new Error('Unknown recall scope')
    const source = pane.continuation
    if (!source?.sourceThreadId || !source.sourceThroughItemId) {
      throw new Error('This chat has no bounded continuation source; older continuations cannot be safely recalled')
    }
    const sourceSurface = source.sourcePaneId ? this.surface(source.sourcePaneId) : null
    const live = sourceSurface?.snapshot({ limit: 0 }).threadId === source.sourceThreadId
      ? sourceSurface.snapshot() : null
    const content = live ?? await surface.readThread(source.sourceThreadId)
    const resolved = this.resolve(caller)
    if (resolved.surface !== surface) throw new Error('Workspace changed while loading memory')
    const latest = resolved.pane.continuation
    if (latest?.sourceThreadId !== source.sourceThreadId || latest.sourceThroughItemId !== source.sourceThroughItemId) {
      throw new Error('Continuation changed while loading its source')
    }
    if (content.threadId !== source.sourceThreadId) throw new Error('Provider returned a different source thread')
    return recallTranscript(content.items, source.sourceThreadId, source.checkpoint ?? null, request, source.sourceThroughItemId)
  }

  private resolve(caller: MemoryCaller) {
    if (caller.signal?.aborted) throw new Error('Memory request was cancelled')
    const pane = this.settings.get().chatPeers.find((entry) => entry.paneId === caller.paneId)
    const surface = pane ? this.surface(pane.paneId) : null
    if (!pane || !surface || !caller.threadId || surface.snapshot({ limit: 0 }).threadId !== caller.threadId) {
      throw new Error('Memory is available only to the calling pane’s current thread')
    }
    return { pane, surface }
  }
}
