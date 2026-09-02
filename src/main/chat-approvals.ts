import type { ChatApproval, ChatApprovalDecision, ChatEvent } from '../shared/chat.js'
import type { AppServerClient, AppServerRequest, RpcId } from './app-server-client.js'
import { isApprovalDecision, nullableString, recordOf, stringOf } from './chat-normalizers.js'

type PendingApproval = {
  rawId: RpcId
  approval: ChatApproval
}

export class ChatApprovals {
  private readonly pending = new Map<string, PendingApproval>()

  constructor(
    private readonly client: AppServerClient,
    private readonly emit: (event: ChatEvent) => void
  ) {}

  snapshot(): ChatApproval[] {
    return [...this.pending.values()].map(({ approval }) => ({ ...approval }))
  }

  respond(requestId: string, decision: ChatApprovalDecision): void {
    const pending = this.pending.get(requestId)
    if (!pending) throw new Error('This approval request is no longer active')
    if (!isApprovalDecision(decision)) throw new Error('Invalid approval decision')
    this.client.respond(pending.rawId, { decision })
    this.resolve(requestId)
  }

  handleServerRequest(request: AppServerRequest): void {
    const params = recordOf(request.params)
    if (request.method === 'item/commandExecution/requestApproval') {
      this.add(request.id, {
        requestId: String(request.id),
        kind: 'command',
        threadId: stringOf(params?.threadId),
        turnId: stringOf(params?.turnId),
        itemId: stringOf(params?.itemId),
        title: 'Allow command?',
        detail: stringOf(params?.command) || 'Run command',
        reason: nullableString(params?.reason)
      })
      return
    }
    if (request.method === 'item/fileChange/requestApproval') {
      const grantRoot = nullableString(params?.grantRoot)
      this.add(request.id, {
        requestId: String(request.id),
        kind: 'fileChange',
        threadId: stringOf(params?.threadId),
        turnId: stringOf(params?.turnId),
        itemId: stringOf(params?.itemId),
        title: 'Allow file changes?',
        detail: grantRoot ? `Allow writes under ${grantRoot}` : 'Apply the proposed changes',
        reason: nullableString(params?.reason)
      })
      return
    }
    this.client.respondWithError(request.id, -32601, `ClosedAI does not support server request ${request.method}`)
  }

  resolve(requestId: string): void {
    if (!requestId || !this.pending.delete(requestId)) return
    this.emit({ type: 'approvalResolved', requestId })
  }

  clear(emitResolved = false): void {
    if (emitResolved) {
      for (const requestId of this.pending.keys()) this.emit({ type: 'approvalResolved', requestId })
    }
    this.pending.clear()
  }

  private add(rawId: RpcId, approval: ChatApproval): void {
    this.pending.set(approval.requestId, { rawId, approval })
    this.emit({ type: 'approval', approval: { ...approval } })
  }
}
