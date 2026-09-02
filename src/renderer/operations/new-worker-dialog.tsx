import type { FormEvent, JSX } from 'react'
import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'

export function NewWorkerDialog({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (task: string, workspace: string) => void
}): JSX.Element {
  const [task, setTask] = useState('')
  const [workspace, setWorkspace] = useState('closedai')
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  function create(event: FormEvent): void {
    event.preventDefault()
    if (!task.trim()) return
    onCreate(task.trim(), workspace)
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
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="ops-primary-button" disabled={!task.trim()}><Sparkles size={14} fill="currentColor" />Create worker</button>
        </footer>
      </form>
    </>
  )
}
