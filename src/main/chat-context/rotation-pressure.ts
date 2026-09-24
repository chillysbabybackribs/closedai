import type { ChatTranscriptItem } from '../../shared/chat.js'

export type RotationPressure = {
  itemCount: number
  toolCallsSinceUser: number
  toolOutputCharsSinceUser: number
}

export type RotationPressureThresholds = {
  atItems: number
  atToolCallsSinceUser: number
  atToolOutputChars: number
}

export type PressureTriggerReason = 'items' | 'toolCalls' | 'toolOutputChars'

/** Count transcript pressure since the latest user message (inclusive of full item count). */
export function measureRotationPressure(items: readonly ChatTranscriptItem[]): RotationPressure {
  let toolCallsSinceUser = 0
  let toolOutputCharsSinceUser = 0
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (item.type === 'user') break
    if (item.type === 'tool') {
      toolCallsSinceUser += 1
      toolOutputCharsSinceUser += item.output?.length ?? 0
    }
  }
  return {
    itemCount: items.length,
    toolCallsSinceUser,
    toolOutputCharsSinceUser
  }
}

export function hasRotationPressureThreshold(thresholds: RotationPressureThresholds): boolean {
  return thresholds.atItems > 0 || thresholds.atToolCallsSinceUser > 0 || thresholds.atToolOutputChars > 0
}

export function pressureTrigger(
  pressure: RotationPressure,
  thresholds: RotationPressureThresholds
): PressureTriggerReason | null {
  if (thresholds.atItems > 0 && pressure.itemCount >= thresholds.atItems) return 'items'
  if (thresholds.atToolCallsSinceUser > 0 && pressure.toolCallsSinceUser >= thresholds.atToolCallsSinceUser) {
    return 'toolCalls'
  }
  if (thresholds.atToolOutputChars > 0 && pressure.toolOutputCharsSinceUser >= thresholds.atToolOutputChars) {
    return 'toolOutputChars'
  }
  return null
}
