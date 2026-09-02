import type { ChatEvent } from '../shared/chat.js'
import type { AppServerNotification } from './app-server-client.js'
import { nullableString, recordOf, stringOf } from './chat-normalizers.js'
import { parseTokenUsage, type ContextUsage } from './chat-context/context-compaction.js'

export type ChatNotificationTarget = {
  activeThreadId: () => string | null
  activeTurnId: () => string | null
  setThreadName: (name: string | null) => void
  setTurn: (turnId: string | null) => void
  consumeItem: (item: unknown, turnId: string | null, completed: boolean) => void
  appendDelta: (itemId: string, field: 'text' | 'output', delta: string) => void
  addNotice: (text: string, tone: 'info' | 'error', turnId?: string | null) => void
  refreshSession: () => void
  noteContextUsage: (usage: ContextUsage) => void
  /** The app-server finished compacting the thread's history. */
  contextCompacted: () => void
  emit: (event: ChatEvent) => void
}

export function routeChatNotification(
  notification: AppServerNotification,
  target: ChatNotificationTarget
): void {
  const params = recordOf(notification.params)
  const threadId = nullableString(params?.threadId)
  if (threadId && target.activeThreadId() && threadId !== target.activeThreadId()) return

  switch (notification.method) {
    case 'thread/name/updated': {
      if (!threadId || threadId !== target.activeThreadId()) break
      const threadName = nullableString(params?.threadName)
      target.setThreadName(threadName)
      target.emit({ type: 'thread', threadId, threadName })
      break
    }
    case 'turn/started': {
      const turn = recordOf(params?.turn)
      if (typeof turn?.id === 'string') target.setTurn(turn.id)
      break
    }
    case 'turn/completed': {
      const turn = recordOf(params?.turn)
      const turnId = typeof turn?.id === 'string' ? turn.id : target.activeTurnId()
      if (Array.isArray(turn?.items)) {
        for (const item of turn.items) target.consumeItem(item, turnId, true)
      }
      target.setTurn(null)
      const status = typeof turn?.status === 'string' ? turn.status : null
      if (status === 'interrupted') target.addNotice('Turn stopped', 'info', turnId)
      if (status === 'failed') {
        const error = recordOf(turn?.error)
        target.addNotice(typeof error?.message === 'string' ? error.message : 'The turn failed', 'error', turnId)
      }
      break
    }
    case 'item/started':
      target.consumeItem(params?.item, stringOf(params?.turnId), false)
      break
    case 'item/completed':
      target.consumeItem(params?.item, stringOf(params?.turnId), true)
      if (recordOf(params?.item)?.type === 'contextCompaction') target.contextCompacted()
      break
    case 'thread/compacted':
      target.contextCompacted()
      break
    case 'thread/tokenUsage/updated': {
      const usage = parseTokenUsage(params?.tokenUsage)
      if (usage) target.noteContextUsage(usage)
      break
    }
    case 'item/agentMessage/delta':
    case 'item/plan/delta':
      target.appendDelta(stringOf(params?.itemId), 'text', stringOf(params?.delta))
      break
    case 'item/commandExecution/outputDelta':
      target.appendDelta(stringOf(params?.itemId), 'output', stringOf(params?.delta))
      break
    case 'error': {
      const error = recordOf(params?.error)
      target.addNotice(
        typeof error?.message === 'string' ? error.message : 'Codex encountered an error',
        'error',
        stringOf(params?.turnId)
      )
      break
    }
    case 'warning':
    case 'configWarning': {
      const text = stringOf(params?.message) || stringOf(params?.summary)
      if (text) target.addNotice(text, 'info', stringOf(params?.turnId))
      break
    }
    case 'serverRequest/resolved':
      break
    case 'account/updated':
    case 'account/login/completed':
      if (notification.method === 'account/login/completed' && params?.success === false) {
        target.addNotice(nullableString(params.error) ?? 'ChatGPT sign-in did not complete', 'error')
      }
      target.refreshSession()
      break
  }
}
