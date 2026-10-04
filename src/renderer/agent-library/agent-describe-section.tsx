import type { JSX } from 'react'
import { useRef } from 'react'
import { Sparkles } from '../icons/index.js'

import { Button } from '../../components/ui/button.js'
import { Loader } from '../../components/ui/loader.js'
import { Textarea } from '../../components/ui/textarea.js'
import { SAVED_AGENT_DESCRIPTION_MAX } from '../../shared/agent-library.js'
import { AGENT_OPTIMIZE_MIN_DESCRIPTION_CHARS } from '../../shared/agent-optimizer.js'
import { AgentSuggestionCards } from './agent-suggestion-cards.js'
import type { AgentSuggestion } from './agent-suggestions.js'
import type { PromptOptimizer } from './use-prompt-optimizer.js'

// Where the Build screen starts: the user's own description of the agent, ideas to start from
// while it is empty, and Optimize, which asks a model to turn the description into instructions.
// The description is the user's text and nothing here rewrites it except picking an idea.

export type AgentDescribeSectionProps = {
  description: string
  /** The editor is saving, starting, or deleting. */
  disabled: boolean
  /** False when no chat is available to lend its model. */
  modelAvailable: boolean
  /** The editor already holds instructions, so Optimize writes a new version. */
  hasInstructions: boolean
  optimizer: Pick<PromptOptimizer, 'running' | 'seconds' | 'error' | 'cancel'>
  onChange: (description: string) => void
  onOptimize: () => void
  /** For a deterministic render in tests. */
  initialSuggestions?: readonly AgentSuggestion[]
}

/** Why Optimize is off, or an empty string when it can run. */
export function optimizeBlocker(description: string, modelAvailable: boolean): string {
  const length = description.trim().length
  if (length < AGENT_OPTIMIZE_MIN_DESCRIPTION_CHARS) return 'Describe the agent first'
  if (length > SAVED_AGENT_DESCRIPTION_MAX) return `Descriptions are limited to ${SAVED_AGENT_DESCRIPTION_MAX} characters`
  if (!modelAvailable) return 'Select a chat that can start runs first; its model writes the instructions'
  return ''
}

export function AgentDescribeSection({ description, disabled, modelAvailable, hasInstructions, optimizer, onChange, onOptimize, initialSuggestions }: AgentDescribeSectionProps): JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null)
  const blocker = optimizeBlocker(description, modelAvailable)
  const locked = disabled || optimizer.running
  const tooLong = description.trim().length > SAVED_AGENT_DESCRIPTION_MAX
  return (
    <div className="agent-describe">
      <label className="agent-builder-label">
        What should this agent do?
        <Textarea ref={field} data-ui="agents.description" value={description} disabled={locked} rows={6}
          className="agent-describe-field agent-library-field resize-none font-normal"
          placeholder="Describe it in your own words, as roughly or as thoroughly as you like: the goal, what to work through, what to leave alone, when it is done."
          onChange={(event) => onChange(event.target.value)} />
      </label>
      {description.trim() === '' && (
        <AgentSuggestionCards disabled={locked} initial={initialSuggestions}
          onPick={(idea) => { onChange(idea.description); field.current?.focus() }} />
      )}
      <div className="agent-optimize-row">
        {optimizer.running ? (
          <>
            <span className="agent-optimize-status">
              <Loader size="sm" text="Writing instructions" /> Writing instructions… {optimizer.seconds}s
            </span>
            <Button type="button" variant="ghost" size="xs" data-ui="agents.optimize-cancel" onClick={optimizer.cancel}>Cancel</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="xs" data-ui="agents.optimize" disabled={disabled || blocker !== ''}
              title={blocker || 'Turn the description into structured instructions with this chat’s model. Takes a minute or two; your description is kept.'}
              onClick={onOptimize}>
              <Sparkles aria-hidden="true" /> {hasInstructions ? 'Optimize again' : 'Optimize'}
            </Button>
            <span className="agent-optimize-hint" role={optimizer.error || tooLong ? 'alert' : undefined} data-tone={optimizer.error || tooLong ? 'error' : undefined}>
              {optimizer.error || (tooLong ? blocker : 'Writes the instructions from your description. You review them before anything runs.')}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
