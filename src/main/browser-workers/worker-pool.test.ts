import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserWorkerPool, type Worker } from './worker-pool.js'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
function fakeWorkers() {
  const created: Array<Worker & { disposed: boolean; dead: boolean }> = []
  return {
    created,
    create: () => {
      const worker = {
        id: `worker-${created.length + 1}`, disposed: false, dead: false,
        navigate: async () => {}, dispose() { worker.disposed = true }, alive: () => !worker.dead
      }
      created.push(worker)
      return worker
    }
  }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

test('leases are capped process-wide and per owner, reuse idle workers, and reap them after the idle period', async () => {
  const workers = fakeWorkers()
  const pool = new BrowserWorkerPool(workers.create, 3, 20)
  const gates = [deferred(), deferred(), deferred(), deferred()]
  const leased: string[] = []
  const signal = new AbortController().signal
  const leases = gates.map((gate, index) => pool.lease(index < 3 ? 'run-a' : 'run-b', signal, async (worker) => {
    leased.push(worker.id)
    await gate.promise
    return worker.id
  }))
  await tick()
  assert.equal(leased.length, 3, 'three of four leases start at once')
  assert.equal(workers.created.length, 3)
  assert.ok(leased.includes('worker-3'), 'the fourth lease belongs to the other owner and takes the third slot')
  gates[0]!.resolve()
  await tick(); await tick()
  assert.equal(leased.length, 4, 'a released worker serves the waiting lease')
  assert.equal(workers.created.length, 3, 'no fourth worker is created')
  for (const gate of gates.slice(1)) gate.resolve()
  await Promise.all(leases)
  assert.equal(pool.size, 3)
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(pool.size, 0, 'idle workers are reaped')
  assert.ok(workers.created.every((worker) => worker.disposed))
  pool.dispose()
})

test('aborting a queued lease releases it; dead workers are replaced; dispose closes idle workers', async () => {
  const workers = fakeWorkers()
  const pool = new BrowserWorkerPool(workers.create, 1, 10_000)
  const gate = deferred()
  const first = pool.lease('run', new AbortController().signal, async (worker) => { await gate.promise; return worker.id })
  const controller = new AbortController()
  const queued = pool.lease('run', controller.signal, async () => 'never')
  await tick()
  controller.abort(new Error('run cancelled'))
  await assert.rejects(queued, /run cancelled/)
  gate.resolve()
  assert.equal(await first, 'worker-1')
  workers.created[0]!.dead = true
  assert.equal(await pool.lease('run', new AbortController().signal, async (worker) => worker.id), 'worker-2')
  assert.equal(workers.created[0]!.disposed, true, 'a dead idle worker is disposed instead of reused')
  pool.dispose()
  assert.equal(workers.created[1]!.disposed, true)
  await assert.rejects(pool.lease('run', new AbortController().signal, async () => 'no'), /shut down/)
})
