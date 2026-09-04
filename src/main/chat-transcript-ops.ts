import type { ChatTranscriptItem } from '../shared/chat.js'

export type TranscriptOp =
  | { type: 'item'; item: ChatTranscriptItem }
  | { type: 'delta'; itemId: string; field: 'text'; delta: string }
  | { type: 'notice'; text: string; tone: 'info' | 'error' }

export type TurnEnd = {
  status: 'completed' | 'interrupted' | 'failed'
  error?: string
}

export type TranscriptSink = {
  upsert(item: ChatTranscriptItem): void
  appendDelta(itemId: string, field: 'text', delta: string): void
}

/** Apply one stream-translator operation to a live transcript. */
export function applyTranscriptOp(
  transcript: TranscriptSink,
  addNotice: (text: string, tone: 'info' | 'error') => void,
  op: TranscriptOp
): void {
  if (op.type === 'item') transcript.upsert(op.item)
  else if (op.type === 'delta') transcript.appendDelta(op.itemId, op.field, op.delta)
  else addNotice(op.text, op.tone)
}

export type TurnEndHooks = {
  addNotice(text: string, tone: 'info' | 'error', turnId: string): void
  setPaused(turnId: string | null): void
  pauseMessage?(end: TurnEnd): { text: string; pausedTurnId: string | null }
}

/** Shared pause/failure notices for direct-call provider services. */
export function handleProviderTurnEnd(turnId: string, end: TurnEnd, hooks: TurnEndHooks): void {
  if (end.status === 'interrupted') {
    const pause = hooks.pauseMessage?.(end) ?? { text: 'Turn paused', pausedTurnId: turnId }
    hooks.addNotice(pause.text, 'info', turnId)
    hooks.setPaused(pause.pausedTurnId)
  }
  if (end.status === 'failed') hooks.addNotice(end.error ?? 'The turn failed', 'error', turnId)
}
