import { useEffect, useState } from 'react'
import { Check, ChevronRight, CircleSlash, Layers, LoaderCircle, XCircle } from './icons/index.js'
import { activityPhase, type ChatTranscriptItem } from '../shared/chat.js'

type Task = Extract<ChatTranscriptItem, { type: 'tool' }>
const live = (item: Task) => ['running', 'pending'].includes(activityPhase(item.status))

export function BackgroundTasks({ items }: { items: Task[] }) {
  const running = items.filter(live).length
  const failed = items.filter((item) => activityPhase(item.status) === 'failed').length
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  useEffect(() => { setExpanded(null) }, [running > 0])
  // Collapsed by default: a group opening itself mid-turn shifts the transcript under the reader.
  const open = expanded ?? false
  // Set like a ledger line: the kind icon, a shimmering verb while anything runs, and what ran.
  const kinds = new Set(items.map((item) => item.background?.kind))
  const noun = kinds.size === 1 && kinds.has('agent') ? 'subagent' : kinds.size === 1 && kinds.has('command') ? 'command' : 'task'
  const what = `${items.length} ${items.length === 1 ? noun : `${noun}s`} in the background`
  return (
    <section className="background-tasks" aria-label="Background work">
      <button type="button" className="background-tasks-heading" data-state={running ? 'running' : failed ? 'failed' : 'done'} data-ui="chat.background-group"
        data-ui-key={items[0]?.id} aria-expanded={open} onClick={() => setExpanded(!open)}>
        {failed && !running ? <XCircle /> : <Layers />}
        <span>{running ? <><span className="activity-live-verb">Running</span> {what}</> : `Ran ${what}`}</span>
        <span className="background-task-meta">{running ? `${items.length - running} of ${items.length} done` : failed ? `${failed} failed` : ''}</span>
        <ChevronRight className={open ? 'is-open' : ''} />
      </button>
      {items.map((item) => {
        const stopped = item.status === 'stopped'
        const phase = activityPhase(item.status)
        const elapsed = item.finishedAt && item.startedAt ? item.finishedAt - item.startedAt
          : live(item) && item.startedAt ? now - item.startedAt : item.background?.durationMs
        return (
          <div key={item.id} className="background-task-anchor">
            {open ? <details className="background-task" data-failed={phase === 'failed' || undefined}>
              <summary data-ui="chat.background-task" data-ui-key={item.id}>
                {live(item) ? <LoaderCircle className="background-task-spinner" /> : stopped ? <CircleSlash /> : phase === 'failed' ? <XCircle /> : <Check />}
                <span className="background-task-name">{item.label}</span>
                <span className="background-task-meta">{live(item) ? 'Running' : stopped ? 'Stopped' : phase === 'failed' ? 'Failed' : 'Completed'}
                  {elapsed !== undefined ? ` · ${Math.max(0, Math.floor(elapsed / 1000))}s` : ''}</span>
              </summary>
              <div className="background-task-body">
                <span className="background-task-meta">{item.background?.kind === 'agent' ? 'Agent' : item.background?.kind === 'command' ? 'Command' : 'Task'}</span>
                <p>{item.detail}</p>
                {item.output ? <pre>{item.output}</pre> : null}
              </div>
            </details> : null}
            {open && live(item) && item.background?.progress ? <p className="background-task-progress">{item.background.progress}</p> : null}
          </div>
        )
      })}
    </section>
  )
}
