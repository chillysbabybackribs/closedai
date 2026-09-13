import type { ChatProvider } from '../../shared/chat.js'
import type { ChatSessionRotation } from '../../shared/session-rotation.js'
import { traceLog } from '../trace/trace-log.js'
import { describeUsage, type ContextUsage, usagePercent } from './context-compaction.js'

export function traceSessionRotated(
  paneId: string | null,
  provider: ChatProvider,
  rotation: ChatSessionRotation,
  usage: ContextUsage | null
): void {
  traceLog.record({ paneId, provider, turnId: null }, {
    kind: 'event',
    label: 'session.rotated',
    summary: usage
      ? `Rotated provider session at ${usagePercent(usage)}% context (epoch ${rotation.epoch})`
      : `Rotated provider session (epoch ${rotation.epoch})`,
    detail: { rotation, usage: usage ? describeUsage(usage) : null }
  })
}
