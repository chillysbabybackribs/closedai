import { needsActiveBrowserContext, type TurnSurfaceContext } from '../chat-context/turn-context.js'
import type { ToolSliceCatalog } from '../../shared/tool-slices.js'

export type ToolSliceTurnInput = {
  prompt: string | null
  surface: TurnSurfaceContext | null
}

const RESEARCH_CONTEXT_CUES = [
  /\b(?:research|look up|lookup|find sources|source material)\b/i,
  /\b(?:compare|contrast)\b.{0,48}\b(?:options|alternatives|providers|products|competitors|vendors|plans|pricing)\b/i,
  /\bcompare\b.{0,12}\b\w+\b.{0,12}\b(?:and|vs\.?|versus)\b/i,
  /\b(?:official|each vendor'?s?|their own)\b.{0,24}\b(?:docs?|documentation|website|site)\b/i,
  /\b(?:only|using)\b.{0,20}\b(?:what|from)\b.{0,24}\b(?:vendor|company|publish)\b/i,
  /\b(?:latest|recent|current)\s+(?:news|developments|landscape)\b/i,
  /\b(?:market|industry)\s+(?:trends|landscape|research)\b/i,
  /\bsearch\s+(?:the\s+)?(?:web|online|internet)\b/i,
  /\b(?:web|news)\s+search\b/i,
  /\bweb tools only\b/i,
  /\bno repo reads?\b/i,
  /\bofficial\b.{0,48}\b(?:docs?|documentation)\b/i,
  /\b(?:public|official)\b.{0,24}\bpricing\b/i,
  /\b(?:hn\.algolia|hacker news)\b/i,
  /\b(?:json response|captured json|xhr|algolia api)\b/i
] as const

const RESEARCH_NEGATIVE_CUES = [
  /\b(?:codebase|workspace|file(?:s)?|function|class|module|test(?:s)?)\b/i,
  /(?<!no )(?<!not )\brepo(?:sitory)?\b/i,
  /\bgrep\b/i,
  /\bnpm run\b/i
] as const

export function selectToolSliceId(catalog: ToolSliceCatalog, turn: ToolSliceTurnInput): string {
  if (needsBrowserToolSlice(turn)) {
    return catalog.signals?.browser?.slice ?? 'browser'
  }
  if (needsResearchToolSlice(turn)) {
    return catalog.signals?.research?.slice ?? 'research'
  }
  return catalog.signals?.default?.slice ?? 'core'
}

export function needsBrowserToolSlice(turn: ToolSliceTurnInput): boolean {
  const prompt = turn.prompt?.trim() ?? ''
  if (prompt && needsActiveBrowserContext(prompt)) return true
  const browser = activeBrowserTab(turn.surface)
  return Boolean(browser?.url && browser.url !== 'about:blank')
}

export function needsResearchToolSlice(turn: ToolSliceTurnInput): boolean {
  const prompt = turn.prompt?.trim() ?? ''
  if (!prompt) return false
  if (RESEARCH_NEGATIVE_CUES.some((cue) => cue.test(prompt))) return false
  return RESEARCH_CONTEXT_CUES.some((cue) => cue.test(prompt))
}

function activeBrowserTab(surface: TurnSurfaceContext | null): { url: string } | null {
  if (!surface || 'surface' in surface) return null
  return surface
}
