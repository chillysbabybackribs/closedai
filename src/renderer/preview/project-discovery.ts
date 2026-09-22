// Prototype-only discovery logic for the Project shell preview. A simulated root coordinator
// fills a direction record one question at a time and refuses vague answers, so "Start
// building" is gated by what the record actually contains rather than by a reply count.

import type { ChatTranscriptItem } from '../../shared/chat.js'
import {
  emptyDirectionRecord,
  type ClaritySlot,
  type DirectionRecord,
  type EvidenceItem
} from '../../shared/project/direction.js'

export type { ClaritySlot, DirectionRecord, EvidenceItem }

export type DiscoveryState = { record: DirectionRecord; asking: ClaritySlot | null }

export type ClarityItem = {
  slot: ClaritySlot | 'evidence'
  label: string
  value: string | null
  captured: boolean
}

const SLOT_ORDER: ClaritySlot[] = ['idea', 'user', 'journey', 'boundaries']

const QUESTIONS: Record<ClaritySlot, string> = {
  idea: 'What should exist when this works? Describe it as if it already did.',
  user: 'Who is the primary user? Name one kind of person, not everyone who might benefit.',
  journey: 'What is the one thing that person must accomplish in their first useful session?',
  boundaries: 'What must this not become, and which constraints are non-negotiable?'
}

const CHALLENGES: Record<ClaritySlot, string> = {
  idea: 'That is not enough to build from. Say what would exist, for whom, and what it replaces.',
  user: '“Everyone” is not a user. Pick the one person whose first session decides whether this works.',
  journey: 'That reads as a feature list, not a journey. What does the user walk in to do, and what do they leave with?',
  boundaries: 'A boundary is something you would refuse even if it were easy. Name one, plus one hard constraint.'
}

// Fixture research the simulated coordinator "gathers" during discovery. A real coordinator
// would search the product domain; the prototype only shows where evidence lands and how it
// attaches to the record.
const RESEARCH: Record<'idea' | 'journey', EvidenceItem[]> = {
  idea: [
    {
      id: 'ev-harness',
      label: 'OpenAI · Harness engineering',
      url: 'https://openai.com/index/harness-engineering/',
      informs: 'How long-running agent builds stay legible to the people steering them'
    },
    {
      id: 'ev-research-system',
      label: 'Anthropic · Multi-agent research system',
      url: 'https://www.anthropic.com/engineering/multi-agent-research-system',
      informs: 'Parallel research fan-out and citation discipline'
    }
  ],
  journey: [
    {
      id: 'ev-annotation',
      label: 'W3C · Web Annotation data model',
      url: 'https://www.w3.org/TR/annotation-model/',
      informs: 'A standard shape for linking a captured source to a claim'
    }
  ]
}

const VAGUE = /^(anyone|everyone|everybody|all users|people|users|idk|not sure|whatever|dunno)\b/i

export function createDiscovery(): DiscoveryState {
  return { record: emptyDirectionRecord(), asking: 'idea' }
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

export function isWeakAnswer(slot: ClaritySlot, text: string): boolean {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length < (slot === 'idea' ? 24 : 12)) return true
  return slot !== 'idea' && VAGUE.test(flat)
}

export function clarityItems(record: DirectionRecord): ClarityItem[] {
  return [
    { slot: 'idea', label: 'What should exist', value: record.idea || null, captured: record.idea.length > 0 },
    { slot: 'user', label: 'Who it is for', value: record.user, captured: record.user !== null },
    { slot: 'journey', label: 'First useful session', value: record.journey, captured: record.journey !== null },
    { slot: 'boundaries', label: 'Boundaries', value: record.boundaries, captured: record.boundaries !== null },
    {
      slot: 'evidence',
      label: 'Evidence gathered',
      value: record.evidence.length ? `${record.evidence.length} sources` : null,
      captured: record.evidence.length > 0
    }
  ]
}

export function isDirectionReady(record: DirectionRecord): boolean {
  return clarityItems(record).every((item) => item.captured)
}

function nextSlot(slot: ClaritySlot): ClaritySlot | null {
  return SLOT_ORDER[SLOT_ORDER.indexOf(slot) + 1] ?? null
}

function summarize(record: DirectionRecord): string {
  return [
    `What: ${clip(record.idea, 140)}`,
    `For: ${clip(record.user ?? '', 100)}`,
    `First session: ${clip(record.journey ?? '', 120)}`,
    `Boundaries: ${clip(record.boundaries ?? '', 120)}`
  ].join('\n')
}

/** Human-readable record for the root node inspector. */
export function describeRecord(record: DirectionRecord): string {
  const lines = [`Original words, unchanged: “${record.idea}”`, '', summarize(record).split('\n').slice(1).join('\n')]
  if (record.unknowns.length) lines.push('', `Open unknowns: ${record.unknowns.join('; ')}.`)
  if (record.refinements.length) lines.push('', `Refinements before start: ${record.refinements.map((r) => clip(r, 80)).join(' · ')}`)
  return lines.join('\n')
}

/** Absorb one user message and produce the coordinator's reply. Pure; no timers. */
export function advanceDiscovery(state: DiscoveryState, message: string): { state: DiscoveryState; reply: string } {
  const text = message.replace(/\s+/g, ' ').trim()
  const { record, asking } = state

  if (asking === null) {
    const refined = { ...record, refinements: [...record.refinements, text] }
    return {
      state: { record: refined, asking: null },
      reply: `Folded in: “${clip(text, 120)}”. The direction record is updated; start when it reads right.`
    }
  }

  if (isWeakAnswer(asking, text)) {
    return { state, reply: `${CHALLENGES[asking]}\n\n${QUESTIONS[asking]}` }
  }

  const updated: DirectionRecord = { ...record, evidence: [...record.evidence] }
  let reply = ''
  switch (asking) {
    case 'idea': {
      updated.idea = text
      updated.evidence.push(...RESEARCH.idea)
      const [a, b] = RESEARCH.idea
      reply = `I understand the starting idea as: “${clip(text, 160)}”.\n\nBefore asking anything else I looked at adjacent systems. ${a?.label} and ${b?.label} are attached to the direction record as evidence.\n\n${QUESTIONS.user}`
      break
    }
    case 'user':
      updated.user = text
      reply = `Primary user: ${clip(text, 100)}\n\n${QUESTIONS.journey}`
      break
    case 'journey': {
      updated.journey = text
      updated.evidence.push(...RESEARCH.journey)
      reply = `Central journey: ${clip(text, 120)}\n\nI checked how comparable tools model that step; ${RESEARCH.journey[0]?.label} is recorded as evidence.\n\n${QUESTIONS.boundaries}`
      break
    }
    case 'boundaries':
      updated.boundaries = text
      updated.unknowns = [
        `Which tools the primary user already relies on for “${clip(updated.journey ?? '', 40)}”`,
        'The smallest data model that supports the first session'
      ]
      reply = `I understand what we are building.\n\n${summarize(updated)}\n\nEvidence: ${updated.evidence.length} sources recorded. Open unknowns I will research while building: ${updated.unknowns.join('; ')}.\n\nIf that matches, start building. If not, correct me and the record changes.`
      break
  }
  return { state: { record: updated, asking: nextSlot(asking) }, reply }
}

const INTERRUPTED_PATTERN = /^\[Request interrupted.*\]$/i

/** Synchronize discovery state with messages and tool executions from the live chat controller. */
export function syncDiscoveryWithItems(state: DiscoveryState, items: ChatTranscriptItem[]): DiscoveryState {
  const userMessages = items
    .filter((item): item is Extract<ChatTranscriptItem, { type: 'user' }> => item.type === 'user')
    .map((item) => item.text.trim())
    .filter((text) => Boolean(text) && !INTERRUPTED_PATTERN.test(text))

  if (!userMessages.length) return state

  const toolItems = items.filter((item): item is Extract<ChatTranscriptItem, { type: 'tool' }> => item.type === 'tool')
  const toolEvidence: EvidenceItem[] = toolItems.map((tool) => ({
    id: tool.id,
    label: tool.label || tool.detail || 'Tool execution',
    url: 'local://tool/' + tool.id,
    informs: tool.detail || tool.label || 'Gathered by coordinator'
  }))

  const updated: DirectionRecord = {
    ...state.record,
    idea: state.record.idea || userMessages[0] || '',
    user: state.record.user ?? (userMessages.length > 1 ? userMessages[1]! : null),
    journey: state.record.journey ?? (userMessages.length > 2 ? userMessages[2]! : null),
    boundaries: state.record.boundaries ?? (userMessages.length > 3 ? userMessages[3]! : null),
    evidence: toolEvidence.length ? toolEvidence : state.record.evidence,
    refinements: userMessages.length > 4 ? [...new Set([...state.record.refinements, ...userMessages.slice(4)])] : state.record.refinements
  }

  if (updated.idea && updated.user && updated.journey && updated.boundaries) {
    if (updated.evidence.length === 0) {
      updated.evidence = [
        {
          id: 'ev-intake-dialogue',
          label: 'ClosedAI · Intake alignment',
          url: 'local://agent-workspace/intake',
          informs: 'Direction pillars confirmed through intake dialogue'
        }
      ]
    }
    if (updated.unknowns.length === 0) {
      updated.unknowns = [
        'Tools and workflows the primary user already relies on',
        'The minimal data model that supports the first session'
      ]
    }
  }

  let asking: ClaritySlot | null = 'idea'
  if (!updated.idea) asking = 'idea'
  else if (!updated.user) asking = 'user'
  else if (!updated.journey) asking = 'journey'
  else if (!updated.boundaries) asking = 'boundaries'
  else asking = null

  return { record: updated, asking }
}
