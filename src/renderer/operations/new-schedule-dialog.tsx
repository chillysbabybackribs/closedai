import type { FormEvent, JSX } from 'react'
import { useEffect, useState } from 'react'
import { CalendarClock, X } from 'lucide-react'
import type { ChatModel } from '../../shared/chat.js'
import type { ScheduleFrequency } from '../../shared/operations.js'

const FREQUENCIES: Array<{ value: ScheduleFrequency; label: string }> = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' }
]

export function NewScheduleDialog({
  onClose,
  onCreate,
  models,
  defaultModel,
  modelsMessage
}: {
  onClose: () => void
  onCreate: (name: string, task: string, workspace: string, modelId: string, frequency: ScheduleFrequency) => Promise<void>
  models: ChatModel[]
  defaultModel: string | null
  modelsMessage: string
}): JSX.Element {
  const [name, setName] = useState('')
  const [task, setTask] = useState('')
  const [workspace, setWorkspace] = useState('closedai')
  const [modelId, setModelId] = useState(defaultModel ?? models[0]?.id ?? '')
  const [frequency, setFrequency] = useState<ScheduleFrequency>('daily')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!modelId && (defaultModel || models[0]?.id)) setModelId(defaultModel ?? models[0]!.id)
  }, [defaultModel, modelId, models])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim() || !task.trim() || !modelId) return
    setError('')
    try {
      await onCreate(name.trim(), task.trim(), workspace, modelId, frequency)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <>
      <button type="button" className="ops-scrim ops-scrim-top" onClick={onClose} aria-label="Close new schedule dialog" />
      <form className="ops-modal" role="dialog" aria-modal="true" aria-labelledby="new-schedule-title" onSubmit={create}>
        <header>
          <div>
            <span className="ops-eyebrow">New schedule</span>
            <h2 id="new-schedule-title">Keep routine work moving</h2>
            <p>Run a worker automatically on a recurring cadence.</p>
          </div>
          <button type="button" className="ops-icon-button" onClick={onClose} aria-label="Close new schedule dialog"><X size={16} /></button>
        </header>
        <label>Schedule name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekly release notes" /></label>
        <label>Worker task<textarea value={task} onChange={(event) => setTask(event.target.value)} placeholder="For example: review open changes and prepare release notes" /></label>
        <div className="ops-form-grid">
          <label>Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as ScheduleFrequency)}>{FREQUENCIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>Workspace<select value={workspace} onChange={(event) => setWorkspace(event.target.value)}><option value="closedai">closedai</option><option value="desktop">desktop</option><option value="platform">platform</option></select></label>
        </div>
        <label>Codex model<select aria-label="Codex model" value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={models.length === 0}>{!modelId ? <option value="">Choose model</option> : null}{models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select>{models.length === 0 ? <small>{modelsMessage}</small> : null}{error ? <small role="alert">{error}</small> : null}</label>
        <p className="ops-schedule-dialog-note"><CalendarClock size={13} />The first run is scheduled one {frequency === 'hourly' ? 'hour' : frequency === 'daily' ? 'day' : 'week'} from now. You can run it immediately from the schedule list.</p>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="ops-primary-button" disabled={!name.trim() || !task.trim() || !modelId}><CalendarClock size={14} />Create schedule</button>
        </footer>
      </form>
    </>
  )
}
