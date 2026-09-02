import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  BrowserHistoryStore,
  LeasedTabBrowserHistory,
  type BrowserHistory,
  type HistoryEntry
} from './browser-history-store.ts'

const directories: string[] = []

after(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
})

async function historyFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codeapp-browser-history-'))
  directories.push(directory)
  return join(directory, 'browser-history.json')
}

test('a leased tab suppresses agent mutations but keeps human history and suggestions', () => {
  const calls: string[] = []
  const persisted: BrowserHistory = {
    record: (url, title) => calls.push(`record:${url}:${title}`),
    updateTitle: (url, title) => calls.push(`title:${url}:${title}`),
    suggest: (input) => {
      calls.push(`suggest:${input}`)
      return { completion: 'example.com/docs', url: 'https://example.com/docs' }
    }
  }
  const history = new LeasedTabBrowserHistory(persisted)

  history.record('https://human.example/', 'Human')
  history.setAgentDriven(true)
  history.record('https://agent.example/', 'Agent')
  history.updateTitle('https://agent.example/', 'Agent title')
  assert.deepEqual(history.suggest('exam'), {
    completion: 'example.com/docs',
    url: 'https://example.com/docs'
  })
  history.setAgentDriven(false)
  history.updateTitle('https://human.example/', 'Human title')

  assert.deepEqual(calls, [
    'record:https://human.example/:Human',
    'suggest:exam',
    'title:https://human.example/:Human title'
  ])
})

test('human navigation still persists, updates, and round-trips through suggestions', async () => {
  const filePath = await historyFile()
  const store = await BrowserHistoryStore.open(filePath)

  store.record('https://www.example.com/docs/start', 'Initial title')
  store.updateTitle('https://www.example.com/docs/start', 'Human docs')
  assert.deepEqual(store.suggest('example.com/docs/'), {
    completion: 'example.com/docs/start',
    url: 'https://www.example.com/docs/start'
  })
  await store.flush()

  const persisted = JSON.parse(await readFile(filePath, 'utf8')) as {
    entries: HistoryEntry[]
  }
  assert.deepEqual(persisted.entries, [{
    key: 'example.com/docs/start',
    url: 'https://www.example.com/docs/start',
    title: 'Human docs',
    visitCount: 1,
    lastVisitedAt: persisted.entries[0].lastVisitedAt
  }])

  const reopened = await BrowserHistoryStore.open(filePath)
  assert.deepEqual(reopened.suggest('example.com/docs/'), {
    completion: 'example.com/docs/start',
    url: 'https://www.example.com/docs/start'
  })
})
