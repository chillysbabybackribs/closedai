import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { OperationsModelCatalog } from '../shared/operations.js'
import { OperationsService } from './operations-service.js'

const catalog: OperationsModelCatalog = {
  selectedModel: 'gpt-5.6-sol',
  models: [{
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    description: 'Test model',
    defaultReasoningEffort: 'medium',
    isDefault: true
  }]
}

test('creates a model-bound run, emits changes, and restores it from disk', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'closedai-operations-'))
  const filePath = join(directory, 'runs.json')
  try {
    const service = await OperationsService.open(filePath, async () => catalog)
    const events: number[] = []
    service.on('changed', (event: { runs: Array<{ id: number }> }) => events.push(event.runs.length))
    const run = await service.create('Ship the next release', 'closedai', 'gpt-5.6-sol')
    assert.equal(run.modelId, 'gpt-5.6-sol')
    assert.equal(run.status, 'queued')
    assert.equal(events.at(-1), 7)
    await service.setStatus(run.id, 'paused')
    assert.equal(service.snapshot().runs[0]?.checkpoint, 'Paused by operator')
    const restored = await OperationsService.open(filePath, async () => catalog)
    assert.equal(restored.snapshot().runs[0]?.task, 'Ship the next release')
    assert.match(await readFile(filePath, 'utf8'), /gpt-5\.6-sol/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects a model that is not in the shared catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'closedai-operations-'))
  try {
    const service = await OperationsService.open(join(directory, 'runs.json'), async () => catalog)
    await assert.rejects(() => service.create('No model', 'closedai', 'missing-model'), /not available/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('persists recurring schedules and turns Run now into a real queued run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'closedai-operations-'))
  const filePath = join(directory, 'runs.json')
  try {
    const service = await OperationsService.open(filePath, async () => catalog)
    const schedule = await service.createSchedule('Daily release notes', 'Prepare release notes', 'closedai', 'gpt-5.6-sol', 'daily')
    assert.equal(schedule.enabled, true)
    assert.equal(service.snapshot().schedules[0]?.frequency, 'daily')
    const run = await service.runScheduleNow(schedule.id)
    assert.equal(run.scheduleId, schedule.id)
    assert.equal(run.status, 'queued')
    assert.equal(service.snapshot().schedules[0]?.lastRunAt !== null, true)
    await service.setScheduleEnabled(schedule.id, false)
    assert.equal(service.snapshot().schedules[0]?.enabled, false)
    await service.deleteSchedule(schedule.id)
    assert.equal(service.snapshot().schedules.length, 0)
    const restored = await OperationsService.open(filePath, async () => catalog)
    assert.equal(restored.snapshot().schedules.length, 0)
    restored.stop()
    service.stop()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('marks a worker failed when runner setup cannot resolve its workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'closedai-operations-'))
  try {
    const service = await OperationsService.open(join(directory, 'runs.json'), async () => catalog, {
      runWorkers: true,
      workspacePath: () => { throw new Error('Workspace is unavailable') }
    })
    const run = await service.create('Run with a live model', 'closedai', 'gpt-5.6-sol')
    let persisted = ''
    for (let attempt = 0; attempt < 20 && !persisted.includes('"status": "failed"'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      persisted = await readFile(join(directory, 'runs.json'), 'utf8').catch(() => '')
    }
    assert.equal(service.snapshot().runs[0]?.id, run.id)
    assert.equal(service.snapshot().runs[0]?.status, 'failed')
    assert.equal(service.snapshot().runs[0]?.checkpoint, 'Workspace is unavailable')
    service.stop()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
