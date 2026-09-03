import type { ChatTranscriptItem } from '../../shared/chat.js'
import { recordOf, stringOf } from './claude-tool-items.js'

type Task = Extract<ChatTranscriptItem, { type: 'tool' }>

/** Session-owned: a task can finish after its spawning turn's result. */
export class ClaudeBackgroundTasks {
  private readonly tasks = new Map<string, Task>()
  private readonly hidden = new Set<string>()

  get running(): boolean {
    return [...this.tasks.values()].some((item) => item.status === 'inProgress')
  }

  stop(): Task[] {
    const stopped = [...this.tasks.values()].filter((item) => item.status === 'inProgress')
      .map((item): Task => ({ ...item, status: 'stopped', finishedAt: Date.now(),
        output: 'The provider session ended before this task reported completion.' }))
    for (const item of stopped) this.tasks.set(item.background!.taskId, item)
    return stopped
  }

  handle(message: Record<string, unknown>, turnId: string | null, replay = false): Task | null {
    const taskId = stringOf(message.task_id)
    if (!taskId) return null
    if (message.ambient === true || message.skip_transcript === true) this.hidden.add(taskId)
    if (this.hidden.has(taskId)) return null
    const previous = this.tasks.get(taskId)
    const terminal = message.subtype === 'task_notification'
    if (previous && previous.status !== 'inProgress' && !terminal) return null
    const usage = recordOf(message.usage)
    const durationMs = typeof usage.duration_ms === 'number' ? usage.duration_ms : previous?.background?.durationMs
    const description = stringOf(message.description) || previous?.label || 'Background task'
    const taskType = stringOf(message.task_type)
    const status = terminal ? stringOf(message.status) || 'completed' : 'inProgress'
    const now = Date.now()
    const item: Task = {
      type: 'tool',
      id: previous?.id ?? `background:claude:${taskId}`,
      turnId: previous?.turnId ?? turnId,
      label: description,
      detail: stringOf(message.prompt) || previous?.detail || description,
      status,
      startedAt: previous?.startedAt ?? (!replay && !terminal ? now : undefined),
      finishedAt: terminal && !replay ? previous?.finishedAt ?? now : undefined,
      output: terminal ? stringOf(message.summary) : previous?.output,
      background: {
        taskId,
        kind: previous?.background?.kind ?? (taskType.includes('agent') || message.subagent_type ? 'agent' : taskType.includes('bash') ? 'command' : 'task'),
        linkedToolId: stringOf(message.tool_use_id) || previous?.background?.linkedToolId,
        progress: terminal ? undefined : stringOf(message.summary) || stringOf(message.last_tool_name) || previous?.background?.progress,
        durationMs
      }
    }
    this.tasks.set(taskId, item)
    return item
  }
}
