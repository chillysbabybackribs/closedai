import type { ChatContextUsage, ChatTurnContextReport } from '../shared/chat.js'

export const CONTEXT_WARM_PERCENT = 50
export const CONTEXT_HOT_PERCENT = 75

export type BudgetSegmentId = 'retained' | 'additions' | 'message' | 'headroom'

export type TokenBudgetSegment = {
  id: BudgetSegmentId
  label: string
  tokens: number
  percent: number
  colorClass: string
  description: string
}

export type ContextPressureLevel = 'cool' | 'warm' | 'hot' | 'unmetered'

export type TokenBudgetBreakdown = {
  segments: TokenBudgetSegment[]
  contextWindow: number | null
  usedTokens: number
  totalCapacityTokens: number
  usedPercent: number
  pressureLevel: ContextPressureLevel
  retainedTokens: number
  additionsTokens: number
  messageTokens: number
  headroomTokens: number
}

export type ContextPressureAdvisory = {
  level: 'warm' | 'hot'
  title: string
  description: string
  recommendation: 'compact' | 'new-chat' | 'both'
}

export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0'
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k`
  }
  return String(tokens)
}

export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return '0%'
  if (percent >= 10) return `${Math.round(percent)}%`
  return `${percent.toFixed(1)}%`
}

export function calculateTokenBudget({
  report,
  usage
}: {
  report: ChatTurnContextReport | null
  usage: ChatContextUsage | null
}): TokenBudgetBreakdown {
  const messageTokens = Math.max(0, report?.message?.estimatedTokens ?? 0)
  const baseAdditions = (report?.additions ?? []).reduce((sum, a) => sum + (a.estimatedTokens || 0), 0)
  const totalAddedText = report?.estimatedAddedTextTokens ?? (messageTokens + baseAdditions)
  const additionsTokens = Math.max(baseAdditions, Math.max(0, totalAddedText - messageTokens))
  const turnTokens = messageTokens + additionsTokens

  if (!usage || !usage.contextWindow || usage.contextWindow <= 0) {
    const total = Math.max(1, turnTokens)
    const msgPct = (messageTokens / total) * 100
    const addPct = (additionsTokens / total) * 100
    const segments: TokenBudgetSegment[] = [
      {
        id: 'message',
        label: 'Current message',
        tokens: messageTokens,
        percent: turnTokens > 0 ? msgPct : 0,
        colorClass: 'segment-message',
        description: 'User message text and turn attachments'
      },
      {
        id: 'additions',
        label: 'ClosedAI additions',
        tokens: additionsTokens,
        percent: turnTokens > 0 ? addPct : 0,
        colorClass: 'segment-additions',
        description: 'System context, browser state, and working memory injected by ClosedAI'
      }
    ]

    return {
      segments,
      contextWindow: null,
      usedTokens: turnTokens,
      totalCapacityTokens: turnTokens,
      usedPercent: 0,
      pressureLevel: 'unmetered',
      retainedTokens: 0,
      additionsTokens,
      messageTokens,
      headroomTokens: 0
    }
  }

  const contextWindow = usage.contextWindow
  const rawUsed = Math.max(0, usage.usedTokens)
  const usedTokens = Math.max(rawUsed, turnTokens)
  const retainedTokens = Math.max(0, usedTokens - turnTokens)
  const headroomTokens = Math.max(0, contextWindow - usedTokens)

  const usedPercent = Math.min(100, Math.max(0, usage.percent > 0 ? usage.percent : Math.round((usedTokens / contextWindow) * 100)))
  const pressureLevel: ContextPressureLevel =
    usedPercent >= CONTEXT_HOT_PERCENT ? 'hot' : usedPercent >= CONTEXT_WARM_PERCENT ? 'warm' : 'cool'

  const retainedPct = Math.min(100, (retainedTokens / contextWindow) * 100)
  const additionsPct = Math.min(100 - retainedPct, (additionsTokens / contextWindow) * 100)
  const messagePct = Math.min(100 - retainedPct - additionsPct, (messageTokens / contextWindow) * 100)
  const headroomPct = Math.max(0, 100 - (retainedPct + additionsPct + messagePct))

  const segments: TokenBudgetSegment[] = [
    {
      id: 'retained',
      label: 'Retained history',
      tokens: retainedTokens,
      percent: retainedPct,
      colorClass: 'segment-retained',
      description: 'Prior conversation turns and tool results retained by the provider'
    },
    {
      id: 'additions',
      label: 'ClosedAI additions',
      tokens: additionsTokens,
      percent: additionsPct,
      colorClass: 'segment-additions',
      description: 'System context, browser state, and working memory injected by ClosedAI'
    },
    {
      id: 'message',
      label: 'Current message',
      tokens: messageTokens,
      percent: messagePct,
      colorClass: 'segment-message',
      description: 'User message text and turn attachments'
    },
    {
      id: 'headroom',
      label: 'Available headroom',
      tokens: headroomTokens,
      percent: headroomPct,
      colorClass: 'segment-headroom',
      description: 'Unused token capacity remaining in the model’s context window'
    }
  ]

  return {
    segments,
    contextWindow,
    usedTokens,
    totalCapacityTokens: contextWindow,
    usedPercent,
    pressureLevel,
    retainedTokens,
    additionsTokens,
    messageTokens,
    headroomTokens
  }
}

export function getContextPressureAdvisory(budget: TokenBudgetBreakdown): ContextPressureAdvisory | null {
  if (budget.pressureLevel === 'hot') {
    return {
      level: 'hot',
      title: `High context pressure (${budget.usedPercent}% used)`,
      description: `The active conversation is nearing the model's context ceiling (${formatTokens(budget.usedTokens)} of ${formatTokens(budget.totalCapacityTokens)} tokens). Generation latency may increase and earlier instructions or tool results risk truncation. Compacting or starting a fresh chat is strongly recommended.`,
      recommendation: 'both'
    }
  }

  if (budget.pressureLevel === 'warm') {
    return {
      level: 'warm',
      title: `Moderate context pressure (${budget.usedPercent}% used)`,
      description: `Context consumption has crossed 50% (${formatTokens(budget.usedTokens)} of ${formatTokens(budget.totalCapacityTokens)} tokens). As history grows, models can experience subtle instruction drift. Consider compacting if supported or branching into a fresh chat if you notice reasoning quality decline.`,
      recommendation: 'compact'
    }
  }

  return null
}
