import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { Textarea } from '../../components/ui/textarea.js'
import { cn } from '../../lib/utils.js'
import { cleanAgentName, describeAgentUse, type SavedAgent, type SavedAgentDraft } from '../../shared/agent-library.js'
import { AGENT_RUN_MAX_PROMPT_CHARS, type AgentRunStartOptions } from '../../shared/agent-runs.js'
import { errorMessage } from '../error-message.js'

// The Agents dialog body (the dialog owns the title bar): the library on the left, one editor
// on the right. Selecting an entry loads it; New clears the editor. Start runs whatever the editor shows, saving a named agent
// first so the run and the library never disagree; a nameless draft starts as a one-off.

export type AgentLibraryPanelProps = {
  agents: readonly SavedAgent[]
  now: number
  /** False while the launching pane cannot start a run (provider unavailable). */
  startEnabled: boolean
  /** Create (id null) or update a saved agent; resolves with the stored record. */
  onSave: (draft: SavedAgentDraft, id: string | null) => Promise<SavedAgent>
  onRemove: (id: string) => Promise<void>
  onStart: (options: AgentRunStartOptions) => Promise<void>
}

type Draft = { name: string; prompt: string; maxCycles: string }
type Busy = 'save' | 'start' | 'delete' | null

const EMPTY_DRAFT: Draft = { name: '', prompt: '', maxCycles: '' }

function draftOf(agent: SavedAgent): Draft {
  return { name: agent.name, prompt: agent.prompt, maxCycles: agent.maxCycles === null ? '' : String(agent.maxCycles) }
}

function parseMaxCycles(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.name.trim() === b.name.trim() && a.prompt.trim() === b.prompt.trim() && parseMaxCycles(a.maxCycles) === parseMaxCycles(b.maxCycles)
}

export function AgentLibraryPanel({ agents, now, startEnabled, onSave, onRemove, onStart }: AgentLibraryPanelProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const selected = agents.find((agent) => agent.id === selectedId) ?? null
  const baseline = selected ? draftOf(selected) : EMPTY_DRAFT
  const dirty = !sameDraft(draft, baseline)
  const name = cleanAgentName(draft.name)
  const prompt = draft.prompt.trim()
  const tooLong = prompt.length > AGENT_RUN_MAX_PROMPT_CHARS
  const canSave = Boolean(name) && Boolean(prompt) && !tooLong && dirty && busy === null
  const canStart = startEnabled && Boolean(prompt) && !tooLong && busy === null

  // A library arriving after mount, or an entry edited elsewhere, refreshes an untouched editor;
  // a selection that was deleted elsewhere falls back to a new draft.
  useEffect(() => {
    if (selectedId !== null && !selected) {
      setSelectedId(null)
      setDraft(EMPTY_DRAFT)
      return
    }
    if (selected && !dirty) {
      setDraft(draftOf(selected))
    }
    // The baseline is derived from `agents`; this reacts to the library, not to typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents])

  function choose(agent: SavedAgent | null): void {
    setSelectedId(agent?.id ?? null)
    setDraft(agent ? draftOf(agent) : EMPTY_DRAFT)
    setError('')
    setConfirmDelete(false)
    if (!agent) window.requestAnimationFrame(() => nameRef.current?.focus())
  }

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
    const saved = await onSave({ name, prompt, maxCycles: parseMaxCycles(draft.maxCycles) }, selectedId)
    setSelectedId(saved.id)
    setDraft(draftOf(saved))
    return saved
  }

  const save = (): Promise<void> => act('save', async () => { await saveDraft() }, 'Could not save the agent')

  const start = (): Promise<void> => act('start', async () => {
    const maxCycles = parseMaxCycles(draft.maxCycles)
    if (!name) {
      await onStart({ prompt, maxCycles, agentId: null, name: null })
      return
    }
    const agent = dirty || !selected ? await saveDraft() : selected
    await onStart({ prompt: agent.prompt, maxCycles: agent.maxCycles, agentId: agent.id, name: agent.name })
  }, 'Could not start the agent')

  const remove = (): Promise<void> => act('delete', async () => {
    if (!selected) return
    await onRemove(selected.id)
    setConfirmDelete(false)
    choose(agents.find((agent) => agent.id !== selected.id) ?? null)
  }, 'Could not delete the agent')

  return (
    <div className="agent-library-split">
      <aside className="agent-library-rail" aria-label="Saved agents">
        <button type="button" className="agent-library-new" data-ui="agents.new" disabled={busy !== null} onClick={() => choose(null)}>
          <Plus size={14} aria-hidden="true" /> New agent
        </button>
        {agents.length === 0 ? (
          <p className="agent-library-rail-empty">Saved agents appear here after you name a draft and Save.</p>
        ) : (
          <div className="agent-library-table-wrap">
            <table className="agent-library-table">
              <thead>
                <tr>
                  <th scope="col">Saved</th>
                  <th scope="col">Use</th>
                </tr>
              </thead>
              <tbody role="listbox" aria-label="Saved agents">
                {agents.map((agent) => {
                  const active = agent.id === selectedId
                  return (
                    <tr key={agent.id} data-active={active || undefined}>
                      <td colSpan={2} className="agent-library-table-row">
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          data-ui="agents.item"
                          data-ui-key={agent.id}
                          disabled={busy !== null}
                          onClick={() => choose(agent)}
                          className="agent-library-item"
                        >
                          <span className="agent-library-item-name">{agent.name}</span>
                          <span className="agent-library-item-meta">
                            {describeAgentUse(agent, now)}
                            {agent.maxCycles !== null ? ` · ${agent.maxCycles} max` : ''}
                          </span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </aside>
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
