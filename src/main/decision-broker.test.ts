import assert from 'node:assert/strict'
import test from 'node:test'

import { DecisionBroker } from './decision-broker.ts'

type Req = { id: string; requestedAt: number; what: string }

test('allow resolves true, deny resolves false, and the pending list tracks both', async () => {
  const broker = new DecisionBroker<Req>(10_000, () => 42)
  const lists: number[] = []
  broker.onChange((pending) => lists.push(pending.length))
  const first = broker.ask({ what: 'a' })
  const second = broker.ask({ what: 'b' })
  const pending = broker.pending()
  assert.deepEqual(pending.map((entry) => [entry.what, entry.requestedAt]), [['a', 42], ['b', 42]])
  broker.resolve(pending[0]!.id, 'allow')
  broker.resolve(pending[1]!.id, 'deny')
  assert.deepEqual([await first, await second], [true, false])
  assert.deepEqual(lists, [1, 2, 1, 0])
  broker.resolve('missing', 'allow')
  assert.deepEqual(lists, [1, 2, 1, 0], 'an unknown id changes nothing')
})

test('an unanswered request denies itself after the timeout', async () => {
  const broker = new DecisionBroker<Req>(5)
  assert.equal(await broker.ask({ what: 'slow' }), false)
  assert.deepEqual(broker.pending(), [])
})

test('an aborted caller withdraws its request as a denial', async () => {
  const broker = new DecisionBroker<Req>(10_000)
  const controller = new AbortController()
  const answer = broker.ask({ what: 'x' }, controller.signal)
  controller.abort()
  assert.equal(await answer, false)
  assert.deepEqual(broker.pending(), [])
})
