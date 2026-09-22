/** Direction record slots filled during project discovery (main-process source of truth). */

export type ClaritySlot = 'idea' | 'user' | 'journey' | 'boundaries'

export type EvidenceItem = { id: string; label: string; url: string; informs: string }

export type DirectionRecord = {
  /** The user's original words. Never rewritten; later steering lands in refinements. */
  idea: string
  user: string | null
  journey: string | null
  boundaries: string | null
  evidence: EvidenceItem[]
  unknowns: string[]
  refinements: string[]
}

export function emptyDirectionRecord(): DirectionRecord {
  return { idea: '', user: null, journey: null, boundaries: null, evidence: [], unknowns: [], refinements: [] }
}
