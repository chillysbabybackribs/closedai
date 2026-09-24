import type { ChatTranscriptItem } from '../../shared/chat.js'
import type { AppSettings } from '../../shared/types.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ContextUsage } from './context-compaction.js'
import {
  hasRotationPressureThreshold,
  measureRotationPressure,
  pressureTrigger,
  type RotationPressureThresholds
} from './rotation-pressure.js'
import { rotationScheduleNotice } from './rotation-schedule-notice.js'
import { SessionRotator } from './session-rotation.js'

export function rotationPressureThresholds(settings: AppSettings): RotationPressureThresholds {
  return {
    atItems: settings.chatRotateAtItems,
    atToolCallsSinceUser: settings.chatRotateAtToolCallsSinceUser,
    atToolOutputChars: settings.chatRotateAtToolOutputChars
  }
}

type CreateSessionRotatorInput = {
  settings: AppSettingsAccess
  threadId: () => string | null
  turnActive: () => boolean
  transcriptItems: () => readonly ChatTranscriptItem[]
  rotate: () => Promise<void>
  notice?: (text: string) => void
  currentUsage?: () => ContextUsage | null
}

export function createSessionRotator(input: CreateSessionRotatorInput): SessionRotator {
  const thresholds = (): RotationPressureThresholds => rotationPressureThresholds(input.settings.get())
  return new SessionRotator({
    enabled: () => input.settings.get().chatSeamlessRotation === true,
    thresholdPercent: () => input.settings.get().chatCompactAtPercent,
    thresholdTokens: () => input.settings.get().chatCompactAtTokens,
    threadId: input.threadId,
    turnActive: input.turnActive,
    rotate: input.rotate,
    pressureTrigger: () => pressureTrigger(measureRotationPressure(input.transcriptItems()), thresholds()),
    hasPressureThresholds: () => hasRotationPressureThreshold(thresholds()),
    onScheduled: (reason) => {
      if (!input.notice) return
      input.notice(rotationScheduleNotice(reason, {
        usage: input.currentUsage?.() ?? null,
        pressure: measureRotationPressure(input.transcriptItems()),
        percentThreshold: input.settings.get().chatCompactAtPercent,
        tokenBudget: input.settings.get().chatCompactAtTokens
      }))
    }
  })
}
