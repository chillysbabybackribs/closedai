// The words the run loop sends. A worker is told one task and how to record it; the coordinator
// is told to plan and nothing else. Neither is asked to open a chat or wait for anything: the
// loop owns dispatch, so a model that tries to run the pipeline itself would duplicate work.

import type { DirectionRecord } from '../../shared/project/direction.js'
import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import type { TreeNode } from '../../shared/project/tree.js'

const JOURNAL_LINES = 6

export function workerBrief(projectPath: string, node: TreeNode, direction: DirectionRecord): string {
  const paths = node.paths?.length ? node.paths.join(', ') : null
  return [
    'You are a worker in the ClosedAI agent workspace. Do exactly one task, then record the result in the project store. Nobody reads your reply; the store is how this lands.',
    '',
    `Project directory: ${projectPath}`,
    `Task id: ${node.id}`,
    `Task: ${node.title}`,
    node.summary ? `In one line: ${node.summary}` : '',
    node.detail ? `Detail: ${node.detail}` : '',
    paths
      ? `Files this task owns: ${paths}. Other workers are running beside you — do not change anything outside that list; if the work truly needs to, stop and record what you found instead.`
      : 'This task declared no files. Other workers may be running beside you, so keep your changes to what the task names and say what you touched.',
    '',
    `What the project is for: ${direction.idea}`,
    direction.boundaries ? `What it must not become: ${direction.boundaries}` : '',
    '',
    'Before you end your turn, call closedai_project.mutate with:',
    `  project_path: "${projectPath}"`,
    `  mutations: [{ "type": "tree", "events": [{ "update": { "id": "${node.id}", "state": "complete", "summary": "<one line naming what changed>" } }], "note": "<one plain sentence the user will read>" }]`,
    'Use state "blocked" instead of "complete" if you could not finish, and put the reason in the summary. Either way, record it: a turn that ends without a store write is treated as a worker that stopped, and the task comes back around.'
  ].filter((line) => line !== '').join('\n')
}

export function nudgeBrief(node: TreeNode, projectPath: string): string {
  return [
    `Your turn ended without recording task ${node.id} ("${node.title}") in the project store, so the workspace still shows it running.`,
    `Finish it if it is not done, then call closedai_project.mutate with project_path "${projectPath}" and a tree update setting ${node.id} to "complete" (or "blocked", with the reason in the summary) plus a one-line note.`
  ].join(' ')
}

export function coordinatorBrief(kind: 'plan' | 'replan', snapshot: ProjectSnapshot): string {
  const tasks = snapshot.tree.filter((node) => node.kind === 'task')
  const done = tasks.filter((node) => node.state === 'complete')
  const blocked = tasks.filter((node) => node.state === 'blocked')
  const opening = kind === 'plan'
    ? 'The build has started and there is nothing to run yet.'
    : blocked.length
      ? `Every task has finished or stopped: ${done.length} complete, ${blocked.length} blocked.`
      : `Every task is complete (${done.length}).`
  return [
    `[run loop] ${opening} Plan the next step; the app opens the workers and dispatches them itself.`,
    '',
    `Read closedai_project.snapshot for ${snapshot.projectPath} first.`,
    blocked.length
      ? `Blocked tasks are waiting on you: ${blocked.map((node) => `${node.id} (${node.summary || 'no reason recorded'})`).join('; ')}. Rewrite, split, or drop them — a blocked task never runs again on its own.`
      : '',
    'Then add the next one to four tasks with closedai_project.mutate: kind "task", state "queued", parent "root" unless they belong under a scope, a short title, a one-line summary, a detail naming the outcome and how to tell it is done, and "paths" listing the repo-relative files or folders the task will touch.',
    'Paths matter: the loop runs tasks in parallel and holds back only the ones whose paths overlap something already running. Tasks that would edit the same file must name it.',
    'If the work is finished, add no tasks — set the phase to "closing" with a note saying what was built.',
    'Do not open chats, do not send messages to workers, and do not do the tasks yourself. The loop dispatches whatever you queue, and anything you start by hand runs twice.',
    'Then tell the user in at most three plain sentences what you queued and why.',
    '',
    recentJournal(snapshot)
  ].filter((line) => line !== '').join('\n')
}

function recentJournal(snapshot: ProjectSnapshot): string {
  const lines = snapshot.journal.slice(-JOURNAL_LINES)
  if (!lines.length) return ''
  return ['What has happened since you last planned:', ...lines.map((line) => `- ${line.text}`)].join('\n')
}
