import { useEffect, useState } from 'react'
import { Popover } from 'radix-ui'
import { Check, ChevronRight, CircleSlash, LoaderCircle, X, XCircle } from 'lucide-react'
import { activityPhase, type ChatTranscriptItem } from '../shared/chat.js'

type Task = Extract<ChatTranscriptItem, { type: 'tool' }>
const live = (item: Task) => ['running', 'pending'].includes(activityPhase(item.status))
const anchor = (id: string) => 'background-task-' + id

export function BackgroundTasks({ items, popup = false }: { items: Task[]; popup?: boolean }) {
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
  const open = expanded ?? (popup || running > 0 || failed > 0)
  return (
    <section className="background-tasks" aria-label="Background work">
      <button type="button" className="background-tasks-heading" data-ui="chat.background-group"
        data-ui-key={items[0]?.id} aria-expanded={open} onClick={() => setExpanded(!open)}>
        {running ? <LoaderCircle className="background-task-spinner" /> : failed ? <XCircle /> : <Check />}
        <span>{running ? 'Background work' : `${items.length} background ${items.length === 1 ? 'task' : 'tasks'} finished`}</span>
        <span className="background-task-meta">{running ? `${running} running · ${items.length - running} finished` : failed ? `${failed} failed` : ''}</span>
        <ChevronRight className={open ? 'is-open' : ''} />
      </button>
      {items.map((item) => {
        const stopped = item.status === 'stopped'
        const phase = activityPhase(item.status)
        const elapsed = item.finishedAt && item.startedAt ? item.finishedAt - item.startedAt
          : live(item) && item.startedAt ? now - item.startedAt : item.background?.durationMs
        return (
          <div key={item.id} id={popup ? undefined : anchor(item.id)} className="background-task-anchor">
            {open ? <details open={popup || undefined} className="background-task" data-failed={phase === 'failed' || undefined}>
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

/** Completed tasks stay in the status line until the next user message. */
export function currentBackgroundTasks(items: ChatTranscriptItem[]): Task[] {
  let lastUser = -1
  for (let index = items.length - 1; index >= 0; index--) {
    if (items[index]?.type === 'user') { lastUser = index; break }
  }
  return items.filter((item, index): item is Task =>
    item.type === 'tool' && Boolean(item.background) && (index > lastUser || live(item)))
}

export function BackgroundTaskIndicator({ items }: { items: ChatTranscriptItem[] }) {
  const tasks = currentBackgroundTasks(items)
  const running = tasks.filter(live).length
  const failed = tasks.some((item) => activityPhase(item.status) === 'failed')
  if (!tasks.length) return null
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="background-task-indicator" data-ui="chat.background-jump">
          {running ? <LoaderCircle className="background-task-spinner" /> : failed ? <XCircle /> : <Check />}
          {tasks.length} background {tasks.length === 1 ? 'task' : 'tasks'} · {running ? `${running} running` : 'finished'}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="background-task-popover" side="top" align="end" sideOffset={10}
          collisionPadding={16} aria-label="Background task details">
          <div className="background-task-popover-title">
            <span>Background work</span>
            <Popover.Close asChild>
              <button type="button" data-ui="chat.background-close" aria-label="Close background task details"><X size={16} /></button>
            </Popover.Close>
          </div>
          <BackgroundTasks items={tasks} popup />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
