import { closedAiDeveloperInstructions } from '../chat-context/developer-instructions.js'
import type { HarnessVariant } from './variants.js'

const APPEND_HINTS = [
  'Prefer read_page with pdf_page for PDFs already open in a tab; avoid navigate unless the user asks to open a URL.',
  'Use embedded_browser.page read_page for in-tab PDF text; set pdf_page when the user names a page.',
  'Do not call navigate when summarizing an open PDF—read_page with pdf_page is enough.',
  'Minimize tool calls: one read_page per requested PDF page unless the user asks for more.',
  'When the user mentions the current tab, read_page without navigate.',
  'Open new URLs with navigate and new_tab: true when isolation is implied.',
  'Wait with wait_for before reading dynamic pages when load timing matters.',
  'Never combine pdf_page with HTML selectors on read_page.',
  'Batch independent reads; serialize mutations on the same browser tab.',
  'Parse tool JSON results; do not paste raw tool payloads to the user.'
]

const PREPEND_EMPHASIS = [
  'Quality first: pick the smallest correct tool sequence.',
  'Speed second: avoid redundant browser round-trips.',
  'Follow ClosedAI browser tab assignment rules before acting on a tab.',
  'Treat harness tasks literally: match the user’s requested action exactly.',
  'Default to read-only browser tools unless the user requests navigation.'
]

function lineCount(): number {
  return closedAiDeveloperInstructions().split('\n').length
}

/** Deterministic prompt mutations for harness sweeps (instruction prepend/omit/append). */
export function generatePromptMutations(count: number): HarnessVariant[] {
  if (!Number.isInteger(count) || count < 1 || count > 512) {
    throw new Error('count must be an integer 1–512')
  }
  const lines = lineCount()
  const out: HarnessVariant[] = []
  for (let i = 0; i < count; i++) {
    const id = `sweep-${String(i).padStart(3, '0')}`
    if (i === 0) {
      out.push({ id, base: 'main' })
      continue
    }
    const instructions: NonNullable<HarnessVariant['overrides']>['instructions'] = {}
    const mode = i % 4
    if (mode === 1) {
      instructions.omitLineIndices = [(i - 1) % lines]
    } else if (mode === 2) {
      instructions.prepend = PREPEND_EMPHASIS[i % PREPEND_EMPHASIS.length]
    } else if (mode === 3) {
      instructions.append = APPEND_HINTS[i % APPEND_HINTS.length]
    } else {
      instructions.prepend = PREPEND_EMPHASIS[(i >> 1) % PREPEND_EMPHASIS.length]
      instructions.append = APPEND_HINTS[(i >> 2) % APPEND_HINTS.length]
    }
    out.push({ id, base: 'main', overrides: { instructions } })
  }
  return out
}
