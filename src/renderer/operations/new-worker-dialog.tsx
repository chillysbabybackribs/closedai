import type { FormEvent, JSX } from 'react'
import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { ChatModel } from '../../shared/chat.js'

export function NewWorkerDialog({
  onClose,
  onCreate,
  models,
  defaultModel,
  modelsMessage
}: {
  onClose: () => void
  onCreate: (task: string, workspace: string, modelId: string) => Promise<void>
  models: ChatModel[]
  defaultModel: string | null
  modelsMessage: string
}): JSX.Element {
  const [task, setTask] = useState('')
  const [workspace, setWorkspace] = useState('closedai')
  const [modelId, setModelId] = useState(defaultModel ?? models[0]?.id ?? '')
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
    if (!task.trim()) return
    setError('')
    try {
      await onCreate(task.trim(), workspace, modelId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <>
      <button type="button" className="ops-scrim ops-scrim-top" onClick={onClose} aria-label="Close new worker dialog" />
      <form className="ops-modal" role="dialog" aria-modal="true" aria-labelledby="new-worker-title" onSubmit={create}>
        <header>
          <div>
            <span className="ops-eyebrow">New worker</span>
            <h2 id="new-worker-title">Delegate long-running work</h2>
            <p>Describe an outcome and choose where the worker can operate.</p>
          </div>
          <button type="button" className="ops-icon-button" onClick={onClose} aria-label="Close new worker dialog"><X size={16} /></button>
        </header>
        <label>
          Task
          <textarea
            autoFocus
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="For example: audit the browser lifecycle and fix any flaky tests"
          />
        </label>
        <label>
          Workspace
          <select value={workspace} onChange={(event) => setWorkspace(event.target.value)}>
            <option value="closedai">closedai</option><option value="desktop">desktop</option><option value="platform">platform</option>
          </select>
        </label>
        <label>
          Codex model
          <select aria-label="Codex model" value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={models.length === 0}>
            {!modelId ? <option value="">Choose model</option> : null}
            {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
          </select>
          {models.length === 0 ? <small>{modelsMessage}</small> : null}
          {error ? <small role="alert">{error}</small> : null}
        </label>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="ops-primary-button" disabled={!task.trim() || !modelId}><Sparkles size={14} fill="currentColor" />Create worker</button>
        </footer>
      </form>
    </>
  )
}
