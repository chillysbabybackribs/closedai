import type { ChatProvider, ChatTranscriptItem } from '../../shared/chat.js'
import type { ChatMemoryCheckpoint } from '../../shared/chat-memory.js'
import { MAX_SESSION_ROTATIONS, type ChatSessionRotation } from '../../shared/session-rotation.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatContinuation } from '../../shared/types.js'
import type { ContextUsage } from './context-compaction.js'
import { buildThreadHandoff, continuationFromThreadHandoff, type ThreadHandoffSource } from './thread-handoff.js'
import { normalizeMemoryCheckpoint } from './memory-checkpoint.js'
import { traceSessionRotated } from './session-rotation-trace.js'

export type RotationSettingsAccess = AppSettingsAccess & {
  checkpoint(): ChatMemoryCheckpoint | null
  sessionRotations(): ChatSessionRotation[]
}

export type PlanProviderRotationInput = {
  paneId: string | null
  provider: ChatProvider
  threadId: string | null
  threadName: string | null
  items: readonly ChatTranscriptItem[]
  checkpoint: ChatMemoryCheckpoint | null
  existingContinuation: ChatContinuation | null
  existingRotations: readonly ChatSessionRotation[]
}

export type PlannedProviderRotation = {
  continuation: ChatContinuation
  rotations: ChatSessionRotation[]
  rotation: ChatSessionRotation
  source: ThreadHandoffSource
}

/** Build continuation metadata and a thin seed for an invisible session rotation. */
export function planProviderRotation(input: PlanProviderRotationInput): PlannedProviderRotation | null {
  const sourceThreadId = input.threadId ?? input.existingContinuation?.sourceThreadId ?? null
  if (!sourceThreadId) return null
  const checkpoint = applicableCheckpoint(input.items, sourceThreadId, input.checkpoint)
  const handoff = buildThreadHandoff([...input.items], input.threadName, checkpoint, { framing: 'compaction' })
  if (!handoff) return null
  const sourceThroughItemId = input.items.at(-1)?.id ?? null
  const source: ThreadHandoffSource = {
    ...handoff,
    provider: input.provider,
    threadId: sourceThreadId,
    sourceThroughItemId,
    checkpoint
  }
  const continuation = mergeRotationContinuation(input.existingContinuation, continuationFromThreadHandoff(input.paneId, source))
  const rotation: ChatSessionRotation = {
    epoch: nextRotationEpoch(input.existingRotations),
    sourceThroughItemId,
    providerThreadId: input.threadId,
    at: Date.now()
  }
  return {
    continuation,
    rotation,
    rotations: appendRotation(input.existingRotations, rotation),
    source
  }
}

function applicableCheckpoint(
  items: readonly ChatTranscriptItem[],
  threadId: string,
  checkpoint: ChatMemoryCheckpoint | null
): ChatMemoryCheckpoint | null {
  const memory = normalizeMemoryCheckpoint(checkpoint)
  if (!memory || memory.threadId !== threadId) return null
  return items.some((item) => item.id === memory.throughItemId) ? memory : null
}

function mergeRotationContinuation(existing: ChatContinuation | null, next: ChatContinuation): ChatContinuation {
  if (!existing?.sourceThreadId) return next
  return {
    ...next,
    sourcePaneId: existing.sourcePaneId ?? next.sourcePaneId,
    sourceThreadId: existing.sourceThreadId,
    sourceProvider: existing.sourceProvider,
    sourceTitle: existing.sourceTitle,
    checkpoint: existing.checkpoint ?? next.checkpoint
  }
}

function nextRotationEpoch(rotations: readonly ChatSessionRotation[]): number {
  return (rotations.at(-1)?.epoch ?? 0) + 1
}

function appendRotation(rotations: readonly ChatSessionRotation[], rotation: ChatSessionRotation): ChatSessionRotation[] {
  return [...rotations, rotation].slice(-MAX_SESSION_ROTATIONS)
}

/** Release the provider thread, persist rotation metadata, and record a trace event. */
export async function applyProviderRotation(
  settings: RotationSettingsAccess,
  input: Omit<PlanProviderRotationInput, 'checkpoint' | 'existingContinuation' | 'existingRotations'>,
  releaseThread: () => Promise<void>,
  usage: ContextUsage | null
): Promise<boolean> {
  const planned = planProviderRotation({
    ...input,
    checkpoint: settings.checkpoint(),
    existingContinuation: settings.get().chatContinuation,
    existingRotations: settings.sessionRotations()
  })
  if (!planned) return false
  await releaseThread()
  await settings.set({
    chatContinuation: planned.continuation,
    chatSessionRotations: planned.rotations
  })
  traceSessionRotated(input.paneId, input.provider, planned.rotation, usage)
  return true
}
