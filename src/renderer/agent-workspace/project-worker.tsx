import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import type { ChatTranscriptItem } from '../../shared/chat.js'
import type { TaskAssignment } from '../../shared/project/tree.js'
import { stamp } from './project-time.js'

/** How often a running worker's log is re-read while its node is open. */
const POLL_MS = 2500
const LOG_ITEMS = 24

/**
 * What a task node shows about the worker carrying it. The worker is an ordinary chat the run
 * loop opened off the tab strip, so this reads its transcript the same bounded way a peer chat
 * is read: the work stays inside the workspace and nothing about it takes over the layout.
 */
export function WorkerPanel({ assignment, live, now }: { assignment: TaskAssignment; live: boolean; now: number }) {
  const [items, setItems] = useState<ChatTranscriptItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const paneId = assignment.paneId

  useEffect(() => {
    let active = true
    const read = (): void => {
      void window.closedai.project.workerLog(paneId, LOG_ITEMS).then((page) => {
        if (!active) return
        setError(null)
        setItems(page?.items ?? [])
      }).catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
    }
    read()
    if (!live) return () => { active = false }
    const timer = window.setInterval(read, POLL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [paneId, live])

  const lines = (items ?? []).map(workerLine).filter((line): line is WorkerLine => line !== null)
  return <section className="project-detail-section project-worker">
    <h2>{live ? 'Worker' : 'Worker that ran this'}</h2>
    <p className="project-worker-status">
      {live && <Loader2 size={12} className="project-worker-spin" aria-hidden="true" />}
      <span>{assignment.activity ?? (live ? 'Working' : 'Finished')}</span>
      <small>
        Started {stamp(assignment.startedAt, now)}
        {assignment.attempts > 1 ? ` · attempt ${assignment.attempts}` : ''}
      </small>
    </p>
    {error && <p className="project-worker-empty">Could not read the worker: {error}</p>}
    {!error && items === null && <p className="project-worker-empty">Reading the worker…</p>}
    {!error && items !== null && lines.length === 0 && <p className="project-worker-empty">The worker has not said anything yet.</p>}
    {lines.length > 0 && <ol className="project-worker-log">
      {lines.map((line) => <li key={line.id} data-kind={line.kind}>
        <span className="project-worker-kind">{line.kind}</span>
        <span className="project-worker-text">{line.text}</span>
      </li>)}
    </ol>}
  </section>
}

type WorkerLine = { id: string; kind: string; text: string }

/** One transcript item as a line on a node: what it was, and the shortest honest description. */
function workerLine(item: ChatTranscriptItem): WorkerLine | null {
  switch (item.type) {
    case 'assistant':
      return item.text.trim() ? { id: item.id, kind: 'says', text: clip(item.text) } : null
    case 'command':
      return { id: item.id, kind: 'runs', text: clip(item.command) }
    case 'fileChange':
      return { id: item.id, kind: 'edits', text: clip(item.changes.map((change) => change.path).join(', ')) }
    case 'tool':
      return { id: item.id, kind: 'uses', text: clip(`${item.label}${item.detail ? ` · ${item.detail}` : ''}`) }
    case 'notice':
      return { id: item.id, kind: item.tone === 'error' ? 'error' : 'note', text: clip(item.text) }
    case 'plan':
      return { id: item.id, kind: 'plans', text: clip(item.text) }
    default:
      // The brief the loop sent, reasoning, and screenshots are not news about the task.
      return null
  }
}

function clip(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}
