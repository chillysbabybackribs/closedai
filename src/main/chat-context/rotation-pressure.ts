import type { ChatTranscriptItem } from '../../shared/chat.js'

export type RotationPressure = {
  itemCount: number
}

export type RotationPressureThresholds = {
  atItems: number
}

export type PressureTriggerReason = 'items'

// Tool-call and tool-output counts are deliberately not triggers: providers record tool work
// differently (Codex shell runs are commands, not tools), and a busy turn at low context lost its
// working evidence for nothing. Context percentage and item count are the backstops.

/** Count only items after the last rotation. */
export function measureRotationPressure(items: readonly ChatTranscriptItem[], throughItemId?: string | null): RotationPressure {
  const boundary = throughItemId ? items.findIndex((item) => item.id === throughItemId) : -1
  // A missing persisted boundary may mean only the new provider history was restored.
  return { itemCount: items.length - (boundary + 1) }
}

export function hasRotationPressureThreshold(thresholds: RotationPressureThresholds): boolean {
  return thresholds.atItems > 0
}

export function pressureTrigger(
  pressure: RotationPressure,
  thresholds: RotationPressureThresholds
): PressureTriggerReason | null {
  if (thresholds.atItems > 0 && pressure.itemCount >= thresholds.atItems) return 'items'
  return null
}
