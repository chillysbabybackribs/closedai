import type { JSX } from 'react'
import { useState } from 'react'
import { Shuffle } from '../icons/index.js'

import { Button } from '../../components/ui/button.js'
import { AGENT_SUGGESTION_COUNT, AGENT_SUGGESTIONS, createSuggestionRotation, type AgentSuggestion } from './agent-suggestions.js'

// Ideas shown under an empty description. One rotation lives for the renderer's lifetime, so
// every visit to the builder deals a set that differs from the one before; Shuffle deals again.

const rotation = createSuggestionRotation(AGENT_SUGGESTIONS, AGENT_SUGGESTION_COUNT)

export type AgentSuggestionCardsProps = {
  disabled: boolean
  /** The user picked an idea: its text becomes the description. */
  onPick: (suggestion: AgentSuggestion) => void
  /** The first set, for a deterministic render in tests; defaults to the next set in the rotation. */
  initial?: readonly AgentSuggestion[]
}

export function AgentSuggestionCards({ disabled, onPick, initial }: AgentSuggestionCardsProps): JSX.Element {
  const [ideas, setIdeas] = useState<readonly AgentSuggestion[]>(() => initial ?? rotation.next())
  return (
    <div className="agent-suggestions">
      <div className="agent-suggestions-head">
        <span>Or start from an idea</span>
        <Button type="button" variant="ghost" size="xs" data-ui="agents.suggestions-shuffle" disabled={disabled}
          title="Show other ideas" onClick={() => setIdeas(rotation.next())}>
          <Shuffle aria-hidden="true" /> Shuffle
        </Button>
      </div>
      <div className="agent-suggestion-grid" role="list" aria-label="Agent ideas">
        {ideas.map((idea) => (
          <button key={idea.id} type="button" role="listitem" className="agent-suggestion" data-ui="agents.suggestion" data-ui-key={idea.id}
            disabled={disabled} title={idea.description} onClick={() => onPick(idea)}>
            <span className="agent-suggestion-category">{idea.category}</span>
            <span className="agent-suggestion-title">{idea.title}</span>
            <span className="agent-suggestion-blurb">{idea.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
