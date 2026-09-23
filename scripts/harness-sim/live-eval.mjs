#!/usr/bin/env node
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const list = args.includes('--list')
const taskId = args.find((a) => a.startsWith('--task='))?.slice(7)

const mod = await import(pathToFileURL(resolve(project, 'src/main/harness/live-eval-tasks.ts')).href)
const tasks = await mod.loadLiveEvalTasks(project)

if (list || !taskId) {
  for (const task of tasks) {
    const model = task.modelId ? ` · ${task.modelId}` : ''
    console.log(`${task.id}${model} — ${task.title}`)
  }
  if (!taskId) {
    console.log('\nShow one task: npm run harness:live -- --task=<id>')
    process.exit(0)
  }
}

const task = mod.findLiveEvalTask(tasks, taskId)
if (!task) {
  console.error(`Unknown live eval task: ${taskId}`)
  process.exit(1)
}
console.log(mod.formatLiveEvalTask(task))
