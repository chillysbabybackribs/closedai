import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const exec = promisify(execFile)

test('launcher reuses a checkout server under concurrent starts and stops only its own instance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-preview-test-'))
  const script = join(root, 'scripts/ui-preview.mjs')
  const run = async (...args) => {
    const result = await exec(process.execPath, [script, ...args], {
      cwd: root, timeout: 30_000, env: { ...process.env, NODE_ENV: 'production' }
    })
    return JSON.parse(result.stdout)
  }
  let running
  try {
    await mkdir(join(root, 'scripts'))
    await mkdir(join(root, 'src/renderer'), { recursive: true })
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir')
    await copyFile(resolve('scripts/ui-preview.mjs'), script)
    await writeFile(join(root, 'web.vite.config.ts'), 'export default {}\n')
    await writeFile(join(root, 'src/renderer/index.html'), '<html><body>Preview launcher fixture</body></html>')
    const [first, second] = await Promise.all([run('start'), run('start', 'split')])
    running = first
    assert.equal(first.pid, second.pid)
    assert.notEqual(first.reused, second.reused)
    assert.equal(new URL(first.url).origin, new URL(second.url).origin)
    assert.equal(new URL(second.url).searchParams.get('scenario'), 'split')
    const page = await fetch(first.url)
    assert.match(await page.text(), /Preview launcher fixture/)
    const status = await run('status')
    assert.equal(status.pid, first.pid)
    assert.equal(status.reused, true)
    assert.equal((await run('stop')).status, 'stopped')
    assert.equal((await run('status')).status, 'stopped')
    // Stale metadata cannot authorize a kill of this test process.
    const stateFile = join(first.log, '..', 'server.json')
    await writeFile(stateFile, JSON.stringify({ root, protocol: 1, pid: process.pid,
      instance: 'stale', url: new URL(first.url).origin }))
    assert.equal((await run('stop')).status, 'stopped')
    await assert.rejects(run('start', 'typo'), /Unknown scenario/)
  } finally {
    await run('stop').catch(() => {})
    if (running) await rm(join(running.log, '..'), { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})
