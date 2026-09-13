import { createHash } from 'node:crypto'
import type { ArtifactDescriptor, ArtifactReservation, ArtifactScope } from '../../shared/investigation-artifacts.js'
import type { ToolContext } from '../tools/tool.js'
import type { ArtifactStore } from './artifact-store.js'

export type ProtocolRetention = {
  key: string
  label: string
  tabId: string
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

/** Caller identity is host-owned; no tool argument can select a peer's durable scope. */
export class ArtifactService {
  constructor(private readonly store: ArtifactStore, private readonly owner: (context: ToolContext) => ArtifactScope) {}

  async retainProtocol(context: ToolContext, input: ProtocolRetention, collect: () => Promise<unknown>): Promise<unknown> {
    const scope = this.owner(context)
    const reservation = await this.reserve(scope, input.key, { kind: 'cdp', ...input }, context.signal)
    if (reservation.state === 'complete') return { artifact: reservation.artifact, replayedReceipt: true, integrity: 'read/export to verify' }
    context.signal.throwIfAborted()
    const startedAt = new Date().toISOString()
    const result = await collect()
    this.sameOwner(context, scope)
    context.signal.throwIfAborted()
    const serialized = JSON.stringify(result)
    if (serialized === undefined) throw new Error('Protocol result is not JSON serializable; reserved operation will not be repeated')
    const bytes = Buffer.from(serialized, 'utf8')
    const artifact = await this.store.request<ArtifactDescriptor>('complete', scope, {
      key: input.key, label: input.label, mediaType: 'application/json', bytes,
      source: { kind: 'cdp', method: input.method, tabId: input.tabId, sessionId: input.sessionId ?? null,
        startedAt, finishedAt: new Date().toISOString(), coherence: 'not-measured',
        representation: 'UTF-8 JSON of host protocol response, before model-output truncation' }
    }, context.signal)
    return { artifact, replayedReceipt: false, untrusted: true }
  }

  async importFile(context: ToolContext, input: { key: string; label: string; path: string; mediaType: string }): Promise<unknown> {
    const scope = this.owner(context)
    const reservation = await this.reserve(scope, input.key, { kind: 'file', ...input }, context.signal)
    if (reservation.state === 'complete') return { artifact: reservation.artifact, replayedReceipt: true, integrity: 'read/export to verify' }
    this.sameOwner(context, scope)
    return { artifact: await this.store.request('import', scope, input, context.signal), untrusted: true }
  }

  async access(context: ToolContext, action: 'list' | 'read' | 'export' | 'delete', input: Record<string, unknown>): Promise<unknown> {
    return this.store.request(action, this.owner(context), input, context.signal)
  }

  private reserve(scope: ArtifactScope, key: string, input: unknown, signal: AbortSignal): Promise<ArtifactReservation> {
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex')
    return this.store.request('reserve', scope, { key, fingerprint }, signal)
  }

  private sameOwner(context: ToolContext, expected: ArtifactScope): void {
    const actual = this.owner(context)
    if (actual.chatId !== expected.chatId || actual.workspace !== expected.workspace) throw new Error('Artifact caller changed during acquisition')
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  }
  return value
}
