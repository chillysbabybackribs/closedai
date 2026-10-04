import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { cn } from '../../lib/utils.js'
import { SAVED_AGENT_DESCRIPTION_MAX, cleanAgentName, savedAgentStartOptions, type SavedAgent, type SavedAgentDraft } from '../../shared/agent-library.js'
import { AGENT_RUN_MAX_PROMPT_CHARS, type AgentRunStartOptions } from '../../shared/agent-runs.js'
import { errorMessage } from '../error-message.js'
import { AgentDescribeSection } from './agent-describe-section.js'
import {
  EMPTY_DRAFT, EMPTY_NOTES, describeSuggestedLimits, draftMaxMinutes, draftOf, oneOffStartOptions, parseMaxCycles, sameDraft, savedDraftOf,
  timeLimitError, withAcceptedProposal, withOptimizeResult, withSuggestedLimits, withUndoneOptimize,
  type AgentBuilderState, type AgentDraft, type HeldAgentDraft, type SuggestedLimits
} from './agent-draft.js'
import { AgentInstructionsSection } from './agent-instructions-section.js'
import { AgentRunSettings } from './agent-run-settings.js'
import { AgentScreenHeader } from './agent-screen-header.js'
import type { AgentSuggestion } from './agent-suggestions.js'
import { usePromptOptimizer, type PromptOptimizerApi } from './use-prompt-optimizer.js'

// The Agents dialog's Build screen: the agent builder. The left column is what the user decides
// (a name, their description, how long the run goes and how much it does unattended); the right
// column is the standing instructions a run starts with, typed directly or written by Optimize
// from the description. This component owns the draft and the save/start/delete actions; the
// sections own their own layout. Start runs whatever the editor shows, saving a named agent
// first so the run and the library never disagree; a nameless draft starts as a one-off.

export type AgentLibraryPanelProps = {
  agents: readonly SavedAgent[]
  /** The saved agent being edited, or null for a new draft. */
  initialAgentId: string | null
  /** A draft the user backed out of earlier this session, restored instead of the saved text. */
  initialDraft?: HeldAgentDraft
  /** False while the launching pane cannot start a run (provider unavailable). */
  startEnabled: boolean
  /** The chat the dialog was opened from: a run docks beside it, and its model writes optimized instructions. */
  launchPaneId: string | null
  /** Create (id null) or update a saved agent; resolves with the stored record. */
  onSave: (draft: SavedAgentDraft, id: string | null) => Promise<SavedAgent>
  onRemove: (id: string) => Promise<void>
  onStart: (options: AgentRunStartOptions) => Promise<void>
  /** Back: `held` is the unsaved state to keep for the session, or null when nothing changed. */
  onBack: (held: HeldAgentDraft | null, agentId: string | null) => void
  /** Start or Delete finished; the view returns to the Library. */
  onDone: () => void
  /** Test seams: the optimize bridge and the first set of ideas. */
  optimizerApi?: () => PromptOptimizerApi | null
  initialSuggestions?: readonly AgentSuggestion[]
}

type Busy = 'save' | 'start' | 'delete' | null

export function AgentLibraryPanel({
  agents, initialAgentId, initialDraft, startEnabled, launchPaneId, onSave, onRemove, onStart, onBack, onDone, optimizerApi, initialSuggestions
}: AgentLibraryPanelProps): JSX.Element {
  const [savedId, setSavedId] = useState(initialAgentId)
  const selected = agents.find((agent) => agent.id === savedId) ?? null
  // The draft, where its instructions came from, and any proposed version move together (agent-draft.ts).
  const [builder, setBuilder] = useState<AgentBuilderState>(() => ({
    draft: initialDraft?.draft ?? (selected ? draftOf(selected) : EMPTY_DRAFT), notes: initialDraft?.notes ?? EMPTY_NOTES, proposal: null
  }))
  const { draft, notes, proposal } = builder
  const setDraft = (next: AgentDraft): void => setBuilder((current) => ({ ...current, draft: next }))
  const [suggested, setSuggested] = useState<SuggestedLimits | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const optimizer = usePromptOptimizer(optimizerApi)
  const descriptionRef = useRef<HTMLDivElement>(null)
  const baseline = selected ? draftOf(selected) : EMPTY_DRAFT
  const dirty = !sameDraft(draft, baseline)
  const name = cleanAgentName(draft.name)
  const prompt = draft.prompt.trim()
  const locked = busy !== null || optimizer.running
  const problem = prompt.length > AGENT_RUN_MAX_PROMPT_CHARS ? `Instructions are limited to ${AGENT_RUN_MAX_PROMPT_CHARS} characters`
    : draft.description.trim().length > SAVED_AGENT_DESCRIPTION_MAX ? `Descriptions are limited to ${SAVED_AGENT_DESCRIPTION_MAX} characters`
    : timeLimitError(draft) ?? ''
  const ready = Boolean(prompt) && !problem && !locked
  const canSave = Boolean(name) && ready && dirty
  const canStart = startEnabled && ready

  useEffect(() => {
    if (initialAgentId === null) descriptionRef.current?.querySelector('textarea')?.focus()
  }, [initialAgentId])

  // An entry edited elsewhere refreshes an untouched editor; one deleted elsewhere keeps its
  // text as a new draft.
  useEffect(() => {
    if (savedId !== null && !selected) {
      setSavedId(null)
      return
    }
    if (selected && !dirty) setDraft(draftOf(selected))
    // The baseline is derived from `agents`; this reacts to the library, not to typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents])

  async function act(kind: Exclude<Busy, null>, action: () => Promise<void>, fallback: string): Promise<void> {
    setBusy(kind)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(errorMessage(failure, fallback))
    } finally {
      setBusy(null)
    }
  }

  const saveDraft = async (): Promise<SavedAgent> => {
    const saved = await onSave(savedDraftOf(draft), savedId)
    setSavedId(saved.id)
    setDraft(draftOf(saved))
    return saved
  }

  const save = (): Promise<void> => act('save', async () => { await saveDraft() }, 'Could not save the agent')

  const start = (): Promise<void> => act('start', async () => {
    if (!name) {
      await onStart(oneOffStartOptions(draft))
    } else {
      const agent = dirty || !selected ? await saveDraft() : selected
      await onStart(savedAgentStartOptions(agent))
    }
    onDone()
  }, 'Could not start the agent')

  const remove = (): Promise<void> => act('delete', async () => {
    if (!selected) return
    await onRemove(selected.id)
    setConfirmDelete(false)
    onDone()
  }, 'Could not delete the agent')

  const optimize = async (): Promise<void> => {
    if (!launchPaneId) return
    setError('')
    const result = await optimizer.run({
      description: draft.description.trim(), paneId: launchPaneId, name,
      maxCycles: parseMaxCycles(draft.maxCycles), maxMinutes: draftMaxMinutes(draft), autonomous: draft.autonomous
    })
    if (!result) return
    // Suggested limits wait for Apply, and autonomy is never the optimizer's to set.
    setSuggested({ maxCycles: result.maxCycles, maxMinutes: result.maxMinutes })
    setBuilder((current) => withOptimizeResult(current, result))
  }

  const held = (): HeldAgentDraft | null => (dirty ? { draft, notes } : null)
  const status = error || problem || (proposal ? 'A new version of the instructions is waiting for your choice' : dirty && selected ? 'Unsaved changes' : '')

  return (
    <div className="agent-screen">
      <AgentScreenHeader title={selected ? selected.name : 'New agent'} onBack={() => onBack(held(), savedId)} />
      <section className="agent-builder" aria-label="Agent builder">
        <div className="agent-builder-side" ref={descriptionRef}>
          <label className="agent-builder-label">
            Name
            <Input className="agent-library-field" data-ui="agents.name" value={draft.name} placeholder="Optional — blank runs once without saving"
              disabled={locked} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <AgentDescribeSection description={draft.description} disabled={busy !== null} modelAvailable={startEnabled && launchPaneId !== null}
            hasInstructions={Boolean(prompt)} optimizer={optimizer} initialSuggestions={initialSuggestions}
            onChange={(description) => setDraft({ ...draft, description })} onOptimize={() => void optimize()} />
          <AgentRunSettings draft={draft} disabled={locked} onChange={setDraft}
            suggestedLimits={suggested ? describeSuggestedLimits(draft, suggested) : null}
            onApplySuggested={() => { if (suggested) setDraft(withSuggestedLimits(draft, suggested)) }} />
        </div>
        <div className="agent-builder-main">
          <AgentInstructionsSection prompt={draft.prompt} disabled={locked} proposal={proposal} assumptions={notes.assumptions}
            canUndo={notes.replaced !== null}
            onChange={(next) => setDraft({ ...draft, prompt: next })} onUndo={() => setBuilder(withUndoneOptimize)}
            onProposalView={(view) => setBuilder((current) => ({ ...current, proposal: current.proposal && { ...current.proposal, view } }))}
            onAcceptProposal={() => setBuilder(withAcceptedProposal)}
            onDismissProposal={() => setBuilder((current) => ({ ...current, proposal: null }))} />
        </div>
      </section>
      <footer className="agent-library-footer">
        {selected && (
          <Button type="button" variant="ghost" size="sm" data-ui="agents.delete" disabled={locked}
            className={cn(confirmDelete && 'text-destructive')}
            onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}>
            {confirmDelete ? 'Confirm delete' : 'Delete'}
          </Button>
        )}
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" role={error || problem ? 'alert' : undefined} title={status}>
          {status}
        </span>
        <Button type="button" variant="ghost" size="sm" data-ui="agents.save" disabled={!canSave} onClick={() => void save()}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" data-ui="agents.start" disabled={!canStart} onClick={() => void start()}>
          {busy === 'start' ? 'Starting…' : 'Start'}
        </Button>
      </footer>
    </div>
  )
}
