import assert from 'node:assert/strict'
import test from 'node:test'
import { StdioJsonRpcClient } from './stdio-json-rpc.js'
import { isMissingExecutable } from './provider-binary.js'

test('a missing executable rejects start with an error that carries the ENOENT code', async () => {
  const client = new StdioJsonRpcClient({
    peer: 'Test peer',
    executable: '/definitely/not/installed/closedai-test-peer',
    cwd: process.cwd(),
    args: () => []
  })
  await assert.rejects(client.start(), (error: NodeJS.ErrnoException) => {
    assert.equal(error.code, 'ENOENT')
    assert.match(error.message, /^Could not start \/definitely\/not\/installed\/closedai-test-peer: /)
    assert.equal(isMissingExecutable(error), true)
    return true
  })
  assert.equal(client.connected, false)
  client.stop()
})
