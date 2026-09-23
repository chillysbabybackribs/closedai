#!/usr/bin/env node
// Draft simulation tasks from registry.call(...) patterns in tool tests. Human review required.
// node scripts/harness-sim/extract-from-tests.mjs [--write]
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const toolsRoot = join(project, 'src/main/tools')
const write = process.argv.includes('--write')

const CALL_RE = /registry\.call\(\s*\{\s*namespace:\s*['"]([^'"]+)['"]\s*,\s*tool:\s*['"]([^'"]+)['"]\s*,\s*arguments:\s*(\{[\s\S]*?\})\s*\}/g

function toolId(namespace, tool) {
  return `${namespace}.${tool}`
}

function slug(argsText) {
  const action = argsText.match(/action:\s*['"]([^'"]+)['"]/)?.[1]
  return action?.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 40) || 'call'
}

async function walk(dir) {
  const out = []
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, name.name)
    if (name.isDirectory()) out.push(...await walk(path))
    else if (name.name.endsWith('.test.ts')) out.push(path)
  }
  return out
}

function draftTask(namespace, tool, argsText, source) {
  let args
  try {
    // eslint-disable-next-line no-new-func
    args = Function(`"use strict"; return (${argsText})`)()
  } catch {
    return null
  }
  const id = `${tool}_${slug(argsText)}`
  return {
    id,
    tool: toolId(namespace, tool),
    intent: `DRAFT from ${relative(project, source)} — replace with user-facing intent.`,
    fixture: 'browser/default',
    replay: [{ namespace, tool, arguments: args }],
    oracle: {
      must_call: [{ namespace, tool, arguments: args, partialArgs: true }],
      max_tool_calls: 4
    },
    tags: ['draft', 'extracted'],
    source: relative(project, source)
  }
}

const byTool = new Map()
for (const file of await walk(toolsRoot)) {
  const text = await readFile(file, 'utf8')
  for (const match of text.matchAll(CALL_RE)) {
    const [, namespace, tool, argsText] = match
    if (namespace === 'null') continue
    const task = draftTask(namespace, tool, argsText, file)
    if (!task) continue
    const key = task.tool
    const list = byTool.get(key) ?? []
    if (list.some((t) => t.id === task.id)) continue
    list.push(task)
    byTool.set(key, list)
  }
}

for (const [tool, tasks] of [...byTool.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const name = `${tool.replace('.', '.')}.draft.json`
  const path = join(project, 'harness/tasks', `${tool}.draft.json`)
  const body = `${JSON.stringify(tasks.slice(0, 12), null, 2)}\n`
  if (write) {
    await writeFile(path, body)
    console.log(`Wrote ${relative(project, path)} (${tasks.length} drafts, capped 12)`)
  } else {
    console.log(`# ${tool} (${tasks.length} calls) → harness/tasks/${basename(path)}`)
    console.log(body.slice(0, 400), tasks.length > 0 ? '…\n' : '\n')
  }
}

if (!write) {
  console.log('Dry run only. Pass --write to emit *.draft.json files (review before promoting).')
}
