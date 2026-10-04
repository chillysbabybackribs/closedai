import type { ChatProvider } from './chat.js'

/** Profile-wide responsiveness settings; provider prompt policy is independent. */
export type PerformanceSettings = {
  instantStreaming: boolean
  warmMinutes: number
  warmIdleChats: number
  autoTitles: boolean
}
export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  instantStreaming: false, warmMinutes: 5, warmIdleChats: 2, autoTitles: true
}

export function normalizePerformanceSettings(value: unknown): PerformanceSettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const bounded = (key: string, min: number, max: number, fallback: number): number => {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
  }
  return {
    instantStreaming: record.instantStreaming === true,
    warmMinutes: bounded('warmMinutes', 1, 60, 5),
    warmIdleChats: bounded('warmIdleChats', 0, 8, 2),
    autoTitles: record.autoTitles !== false
  }
}

export type ResponseSample = {
  paneId: string
  turnId: string | null
  provider: ChatProvider
  baselineEnabled: boolean
  preparationMs: number
  firstTextMs: number | null
  totalMs: number | null
  rendererMs: number | null
}
export type ResponsePerformanceGroup = {
  provider: ChatProvider
  baselineEnabled: boolean
  turns: number
  completed: number
  rendererSamples: number
  preparationMs: number
  firstTextMs: number | null
  totalMs: number | null
  rendererMs: number | null
}
export type ResponsePerformanceSummary = {
  capacity: number
  samples: number
  groups: ResponsePerformanceGroup[]
}
export type ResponsePaint = { paneId: string; turnId: string; rendererMs: number }
