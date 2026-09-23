import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type LiveEvalSetup = {
  browserUrl?: string
  revealBrowser?: boolean
}

export type LiveEvalTask = {
  id: string
  title: string
  user: string
  provider?: 'cursor' | 'codex' | 'claude' | 'antigravity'
  modelId?: string
  setup?: LiveEvalSetup
  observe: string[]
  tags?: string[]
}

export function liveEvalTasksPath(projectRoot: string): string {
  return join(projectRoot, 'harness/live-eval/tasks.json')
}

export async function loadLiveEvalTasks(projectRoot: string): Promise<LiveEvalTask[]> {
  const raw = JSON.parse(await readFile(liveEvalTasksPath(projectRoot), 'utf8')) as unknown
  if (!Array.isArray(raw)) throw new Error('harness/live-eval/tasks.json must be a JSON array')
  return raw as LiveEvalTask[]
}

export function findLiveEvalTask(tasks: LiveEvalTask[], id: string): LiveEvalTask | undefined {
  return tasks.find((task) => task.id === id)
}

export function formatLiveEvalTask(task: LiveEvalTask): string {
  const lines = [
    `Task: ${task.id}`,
    `Title: ${task.title}`,
    ...(task.modelId ? [`Model: ${task.modelId}`] : []),
    ...(task.setup?.browserUrl ? [`Browser setup URL: ${task.setup.browserUrl}`] : []),
    '',
    'User message (paste or send_message):',
    task.user,
    '',
    'Observe:',
    ...task.observe.map((item) => `- ${item}`)
  ]
  return lines.join('\n')
}
