import assert from 'node:assert/strict'
import test from 'node:test'
import { commandKind, commandPhrase, toolPhrase } from './activity-phrase.ts'

test('read commands name the file instead of dumping sed', () => {
  assert.equal(commandPhrase("bash -lc 'sed -n 1,240p src/main/tools/manifest.ts'"), 'Read manifest.ts')
  assert.equal(commandPhrase("sed -n '1,20p' package.json"), 'Read package.json')
  assert.equal(commandPhrase('cat src/renderer/chat-pane.tsx'), 'Read chat-pane.tsx')
  assert.equal(commandKind("bash -lc 'sed -n 1,240p src/main/tools/manifest.ts'"), 'read')
})

test('search commands keep the query, not the flags', () => {
  assert.equal(commandPhrase('bash -lc "rg AGENTS.md"'), 'Searched for AGENTS.md')
  assert.equal(
    commandPhrase("rg -n 'createToolRegistry|browserTools|workspaceTools|captureTool'"),
    'Searched for createToolRegistry|browserTools|wor…'
  )
  assert.equal(commandKind('bash -lc "rg src"'), 'search')
})

test('file listings and git stay short', () => {
  assert.equal(commandPhrase('rg --files /home/dp/Desktop/appv1codeapp/src/main'), 'Listed files in main')
  assert.equal(
    commandPhrase(`/bin/bash -lc "pwd && rg --files -g 'AGENTS.md' -g '!node_modules'"`),
    'Listed files'
  )
  assert.equal(commandPhrase('bash -lc "git status"'), 'Checked git status')
  assert.equal(commandPhrase('npm test'), 'Ran tests')
})

test('unknown commands collapse to the verb', () => {
  assert.equal(commandPhrase('ffmpeg -i in.mp4 out.mp4'), 'Ran ffmpeg')
})

test('tool labels become process English', () => {
  assert.equal(toolPhrase('Web search'), 'Searched the web')
  assert.equal(toolPhrase('Web search', 2), 'Searched the web 2 times')
  assert.equal(toolPhrase('inspect', 2), 'Inspected 2')
  assert.equal(toolPhrase('Viewed image'), 'Viewed image')
})
