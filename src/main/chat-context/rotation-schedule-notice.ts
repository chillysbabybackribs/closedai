import type { ContextUsage } from './context-compaction.js'
import { usagePercent } from './context-compaction.js'
import type { RotationPressure } from './rotation-pressure.js'
import type { RotationTriggerReason } from './session-rotation.js'

export type RotationScheduleNoticeInput = {
  usage: ContextUsage | null
  pressure: RotationPressure
  percentThreshold: number
  tokenBudget: number
}

export function rotationScheduleNotice(reason: RotationTriggerReason, input: RotationScheduleNoticeInput): string {
  switch (reason) {
    case 'percent': {
      const percent = input.usage ? usagePercent(input.usage) : input.percentThreshold
      return `Context is at ${percent}% of the model window; provider context will rotate while idle`
    }
    case 'tokens':
      return input.usage
        ? `Context has ${input.usage.usedTokens} tokens (target ${input.tokenBudget}); provider context will rotate while idle`
        : `Context passed the token target (${input.tokenBudget}); provider context will rotate while idle`
    case 'items':
      return `Transcript has ${input.pressure.itemCount} items; provider context will rotate while idle`
    case 'toolCalls':
      return `${input.pressure.toolCallsSinceUser} tool calls since your last message; provider context will rotate while idle`
    case 'toolOutputChars':
      return `${input.pressure.toolOutputCharsSinceUser} characters of tool output since your last message; provider context will rotate while idle`
    default:
      return 'Provider context will rotate while idle'
  }
}
