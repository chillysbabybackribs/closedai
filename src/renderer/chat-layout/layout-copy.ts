import type { TabActivity } from './tab-activity.js'

export type TaskRow = { running?: boolean; paused?: boolean }

export function tabCloseHint(state?: TabActivity['state']): string {
  return state === 'working' ? 'Task keeps running'
    : state === 'paused' ? 'Task stays paused'
      : 'Does not stop tasks'
}

export function paneHideHint(states: Array<TabActivity['state'] | undefined>): string {
  if (states.includes('working')) return 'Tasks keep running'
  if (states.includes('paused')) return 'Tasks stay paused'
  return 'Does not stop tasks'
}

export function removalNotice(label: string, rows: TaskRow[]): string {
  const detail = rows.some((row) => row.running) ? 'Tasks continue in the background'
    : rows.some((row) => row.paused) ? 'Tasks remain paused' : ''
  return detail ? `${label} · ${detail}` : label
}
