import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { launchProcess } from './launch-process.mjs'

const linux = process.platform === 'linux'
async function running(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z'
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
async function assertStopped(pid) {
  for (let i = 0; i < 100 && await running(pid); i++) await delay(10)
  assert.equal(await running(pid), false, `PID ${pid} survived cleanup`)
}
const descendantCode = `process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)`
function fixture(exitLeader) {
  return `
    const {spawn} = require('node:child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantCode)}], {stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
    child.once('message', () => {
      process.send(child.pid, () => { ${exitLeader ? 'process.exit(0)' : ''} });
    });
    setInterval(() => {}, 1000);
  `
}

for (const exitLeader of [true, false]) {
  test(`cleans stubborn grandchildren when leader ${exitLeader ? 'exits first' : 'is stopped'}`, { skip: !linux }, async (t) => {
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' })
    t.after(() => { try { process.kill(-unrelated.pid, 'SIGKILL') } catch {} })
    const launch = launchProcess(process.execPath, ['-e', fixture(exitLeader)], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    }, { graceMs: 100 })
    t.after(() => { try { process.kill(-launch.child.pid, 'SIGKILL') } catch {} })
    const [descendant] = await once(launch.child, 'message')
    if (!exitLeader) await launch.stop('SIGTERM')
    await launch.completed
    await assertStopped(descendant)
    assert.equal(await running(unrelated.pid), true, 'another launch must survive')
  })
}

test('reports spawn failure without trying to signal an absent PID', async () => {
  const launch = launchProcess('/closedai-does-not-exist', [], { stdio: 'ignore' })
  await assert.rejects(launch.completed, { code: 'ENOENT' })
  await launch.stop()
})
