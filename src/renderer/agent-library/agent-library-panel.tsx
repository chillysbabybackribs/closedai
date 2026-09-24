import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { Textarea } from '../../components/ui/textarea.js'
import { cn } from '../../lib/utils.js'
import { cleanAgentName, type SavedAgent, type SavedAgentDraft } from '../../shared/agent-library.js'
import { AGENT_RUN_MAX_PROMPT_CHARS, type AgentRunStartOptions } from '../../shared/agent-runs.js'
import { errorMessage } from '../error-message.js'
import { AgentScreenHeader } from './agent-screen-header.js'

// The Agents tab's Build screen: one editor for a new draft or one saved agent. Start runs
// whatever the editor shows, saving a named agent first so the run and the library never
// disagree; a nameless draft starts as a one-off. Start and Delete return to the Library.

export type AgentDraft = { name: string; prompt: string; maxCycles: string }

export type AgentLibraryPanelProps = {
  agents: readonly SavedAgent[]
  /** The saved agent being edited, or null for a new draft. */
  initialAgentId: string | null
  /** A draft the user backed out of earlier this session, restored instead of the saved text. */
  initialDraft?: AgentDraft
  /** False while the launching pane cannot start a run (provider unavailable). */
  startEnabled: boolean
  /** Create (id null) or update a saved agent; resolves with the stored record. */
  onSave: (draft: SavedAgentDraft, id: string | null) => Promise<SavedAgent>
  onRemove: (id: string) => Promise<void>
  onStart: (options: AgentRunStartOptions) => Promise<void>
  /** Back: `draft` is the unsaved text to keep for the session, or null when nothing changed. */
  onBack: (draft: AgentDraft | null, agentId: string | null) => void
  /** Start or Delete finished; the view returns to the Library. */
  onDone: () => void
}

type Busy = 'save' | 'start' | 'delete' | null

export const EMPTY_DRAFT: AgentDraft = { name: '', prompt: '', maxCycles: '' }

export function draftOf(agent: SavedAgent): AgentDraft {
  return { name: agent.name, prompt: agent.prompt, maxCycles: agent.maxCycles === null ? '' : String(agent.maxCycles) }
}

function parseMaxCycles(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function sameDraft(a: AgentDraft, b: AgentDraft): boolean {
  return a.name.trim() === b.name.trim() && a.prompt.trim() === b.prompt.trim() && parseMaxCycles(a.maxCycles) === parseMaxCycles(b.maxCycles)
}

export function AgentLibraryPanel({ agents, initialAgentId, initialDraft, startEnabled, onSave, onRemove, onStart, onBack, onDone }: AgentLibraryPanelProps): JSX.Element {
  const [savedId, setSavedId] = useState(initialAgentId)
  const selected = agents.find((agent) => agent.id === savedId) ?? null
  const [draft, setDraft] = useState<AgentDraft>(() => initialDraft ?? (selected ? draftOf(selected) : EMPTY_DRAFT))
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const baseline = selected ? draftOf(selected) : EMPTY_DRAFT
  const dirty = !sameDraft(draft, baseline)
  const name = cleanAgentName(draft.name)
  const prompt = draft.prompt.trim()
  const tooLong = prompt.length > AGENT_RUN_MAX_PROMPT_CHARS
  const canSave = Boolean(name) && Boolean(prompt) && !tooLong && dirty && busy === null
  const canStart = startEnabled && Boolean(prompt) && !tooLong && busy === null

  useEffect(() => { if (initialAgentId === null) nameRef.current?.focus() }, [initialAgentId])

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
    const saved = await onSave({ name, prompt, maxCycles: parseMaxCycles(draft.maxCycles) }, savedId)
    setSavedId(saved.id)
    setDraft(draftOf(saved))
    return saved
  }

  const save = (): Promise<void> => act('save', async () => { await saveDraft() }, 'Could not save the agent')

  const start = (): Promise<void> => act('start', async () => {
    if (!name) {
      await onStart({ prompt, maxCycles: parseMaxCycles(draft.maxCycles), agentId: null, name: null })
    } else {
      const agent = dirty || !selected ? await saveDraft() : selected
      await onStart({ prompt: agent.prompt, maxCycles: agent.maxCycles, agentId: agent.id, name: agent.name })
    }
    onDone()
  }, 'Could not start the agent')

  const remove = (): Promise<void> => act('delete', async () => {
    if (!selected) return
    await onRemove(selected.id)
    setConfirmDelete(false)
    onDone()
  }, 'Could not delete the agent')

  return (
    <div className="agent-screen">
      <AgentScreenHeader title={selected ? selected.name : 'New agent'} onBack={() => onBack(dirty ? draft : null, savedId)} />
      <section className="agent-library-editor" aria-label="Agent editor">
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium">
            Name
            <Input ref={nameRef} className="agent-library-field" data-ui="agents.name" value={draft.name} placeholder="Optional — blank runs once without saving"
              disabled={busy !== null} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="flex w-32 shrink-0 flex-col gap-1 text-xs font-medium">
            Cycle limit
            <Input className="agent-library-field" data-ui="agents.max-cycles" type="number" min={1} inputMode="numeric" value={draft.maxCycles} placeholder="None"
              disabled={busy !== null} onChange={(event) => setDraft({ ...draft, maxCycles: event.target.value })} />
          </label>
        </div>
        <label className="flex min-h-0 flex-1 flex-col gap-1 text-xs font-medium">
          Instructions
          <Textarea data-ui="agents.prompt" value={draft.prompt} spellCheck={false} disabled={busy !== null}
            placeholder="Example: Each cycle, read closedai_app.state, pick one workflow to exercise, fix any bug you find, and report one line: cycle — workflow — result."
            className="agent-library-prompt agent-library-field min-h-0 flex-1 resize-none font-normal"
            onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} />
        </label>
        <footer className="agent-library-footer">
          {selected && (
            <Button type="button" variant="ghost" size="sm" data-ui="agents.delete" disabled={busy !== null}
              className={cn(confirmDelete && 'text-destructive')}
              onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}>
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </Button>
          )}
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" role={error ? 'alert' : undefined}>
            {error || (tooLong ? `Instructions are limited to ${AGENT_RUN_MAX_PROMPT_CHARS} characters` : dirty && selected ? 'Unsaved changes' : '')}
          </span>
          <Button type="button" variant="ghost" size="sm" data-ui="agents.save" disabled={!canSave} onClick={() => void save()}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" size="sm" data-ui="agents.start" disabled={!canStart} onClick={() => void start()}>
            {busy === 'start' ? 'Starting…' : 'Start'}
          </Button>
        </footer>
      </section>
    </div>
  )
}
