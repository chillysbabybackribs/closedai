import type { ChatProvider } from '../../shared/chat.js'
import type { ChatSessionRotation } from '../../shared/session-rotation.js'
import { traceLog } from '../trace/trace-log.js'
import { describeUsage, type ContextUsage, usagePercent } from './context-compaction.js'

export function traceSessionRotated(
  paneId: string | null,
  provider: ChatProvider,
  rotation: ChatSessionRotation,
  usage: ContextUsage | null,
  elapsedMs?: number
): void {
  traceLog.record({ paneId, provider, turnId: null }, {
    kind: 'event',
    label: 'session.rotated',
    summary: usage
      ? `Rotated provider session at ${usagePercent(usage)}% context (epoch ${rotation.epoch}${reasonSuffix(rotation)})`
      : `Rotated provider session (epoch ${rotation.epoch}${reasonSuffix(rotation)})`,
    detail: {
      rotation,
      usage: usage ? describeUsage(usage) : null,
      ...(elapsedMs !== undefined && Number.isFinite(elapsedMs) ? { elapsedMs: Math.max(0, Math.round(elapsedMs)) } : {})
    }
  })
}

function reasonSuffix(rotation: ChatSessionRotation): string {
  return rotation.reason ? `, ${rotation.reason}` : ''
}
