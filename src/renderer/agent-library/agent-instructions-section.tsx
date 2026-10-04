import type { JSX } from 'react'

import { Button } from '../../components/ui/button.js'
import { Textarea } from '../../components/ui/textarea.js'
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group.js'
import { AGENT_RUN_MAX_PROMPT_CHARS } from '../../shared/agent-runs.js'
import type { InstructionsProposal } from './agent-draft.js'

// The standing instructions: what a run is actually started with. They can be typed directly,
// written by Optimize, or both. Instructions the user edited by hand are never replaced without
// asking: a new version from the optimizer arrives as a proposal shown beside theirs, and stays a
// proposal until they choose it.

export type AgentInstructionsSectionProps = {
  prompt: string
  disabled: boolean
  proposal: InstructionsProposal | null
  /** What the optimizer assumed when it wrote the instructions now in the editor. */
  assumptions: readonly string[]
  /** The last optimize replaced earlier instructions, which Undo brings back. */
  canUndo: boolean
  onChange: (prompt: string) => void
  onUndo: () => void
  onProposalView: (view: 'proposed' | 'current') => void
  onAcceptProposal: () => void
  onDismissProposal: () => void
}

export function AgentInstructionsSection({
  prompt, disabled, proposal, assumptions, canUndo, onChange, onUndo, onProposalView, onAcceptProposal, onDismissProposal
}: AgentInstructionsSectionProps): JSX.Element {
  const showingProposal = proposal?.view === 'proposed'
  const listed = showingProposal ? proposal.assumptions : proposal ? [] : assumptions
  const length = prompt.trim().length
  return (
    <div className="agent-instructions">
      <div className="agent-instructions-head">
        <label className="agent-builder-label" htmlFor="agent-instructions-field">Instructions</label>
        {proposal ? (
          <ToggleGroup type="single" variant="outline" size="sm" aria-label="Which instructions to show" value={proposal.view}
            onValueChange={(view) => { if (view === 'proposed' || view === 'current') onProposalView(view) }}>
            <ToggleGroupItem value="proposed" className="h-6 px-2 text-xs" data-ui="agents.proposal-view" data-ui-key="proposed">New version</ToggleGroupItem>
            <ToggleGroupItem value="current" className="h-6 px-2 text-xs" data-ui="agents.proposal-view" data-ui-key="current">Yours</ToggleGroupItem>
          </ToggleGroup>
        ) : (
          <>
            <span className="agent-instructions-note">
              {length > AGENT_RUN_MAX_PROMPT_CHARS ? `${length} of ${AGENT_RUN_MAX_PROMPT_CHARS} characters` : 'Sent as cycle 1 and again after a context rotation'}
            </span>
            {canUndo && <Button type="button" variant="ghost" size="xs" data-ui="agents.optimize-undo" disabled={disabled} onClick={onUndo}>Undo optimize</Button>}
          </>
        )}
      </div>
      {proposal && (
        <div className="agent-proposal" role="status">
          <span className="agent-proposal-text">
            A new version is ready. You edited the current instructions by hand, so nothing was replaced.
          </span>
          <Button type="button" variant="ghost" size="xs" data-ui="agents.proposal-dismiss" disabled={disabled} onClick={onDismissProposal}>Keep mine</Button>
          <Button type="button" size="xs" data-ui="agents.proposal-accept" disabled={disabled} onClick={onAcceptProposal}>Use new version</Button>
        </div>
      )}
      {showingProposal ? (
        <Textarea id="agent-instructions-field" data-ui="agents.proposal-text" value={proposal.prompt} readOnly spellCheck={false}
          aria-label="Proposed instructions" className="agent-library-prompt agent-library-field min-h-0 flex-1 resize-none font-normal" />
      ) : (
        <Textarea id="agent-instructions-field" data-ui="agents.prompt" value={prompt} spellCheck={false} disabled={disabled}
          placeholder="Optimize a description to have these written for you, or type them yourself. Example: Each cycle, read your progress file, pick one item, do it, verify it, and report one line: cycle — item — result."
          className="agent-library-prompt agent-library-field min-h-0 flex-1 resize-none font-normal"
          onChange={(event) => onChange(event.target.value)} />
      )}
      {listed.length > 0 && (
        <div className="agent-assumptions" data-ui="agents.assumptions">
          <p className="agent-assumptions-head">
            Assumed where your description was silent. To change one, say so in the description and optimize again, or edit the instructions.
          </p>
          <ul>
            {listed.map((assumption) => <li key={assumption}>{assumption}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
