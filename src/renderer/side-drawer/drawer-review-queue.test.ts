import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { reviewTransitions } from './drawer-controller.js'
import {
  DRAWER_REVIEW_QUEUE_STORAGE_KEY,
  DRAWER_REVIEW_RETENTION_MS,
  dequeueDrawerReview,
  enqueueDrawerReview,
  expireDrawerReviews,
  markDrawerReviewViewed,
  nextDrawerReviewExpiry,
  pruneDrawerReviewQueue,
  readDrawerReviewQueue
} from './drawer-review-queue.js'

function peer(paneId: string, running: boolean): ChatRowSummary {
  return {
    paneId,
    pinnedAt: null,
    parentPaneId: null,
    kind: 'peer',
    provider: 'claude',
    modelId: null,
    threadId: `thread-${paneId}`,
    title: `Chat ${paneId}`,
    preview: '',
    cwd: '/w',
    createdAt: 1,
    lastTurnEndedAt: null,
    updatedAt: 1,
    attached: true,
    running,
    activity: null
  }
}

test('a stored queue loads legacy timestamps as unread entries and drops junk', () => {
  const storage = {
    getItem: () => JSON.stringify({
      legacy: 1200,
      current: { queuedAt: 1300, viewed: true },
      timestamped: { queuedAt: 1400, viewedAt: 1500 },
      broken: { viewed: true },
      '': 5,
      negative: -1
    })
  }
  assert.deepEqual(readDrawerReviewQueue(storage), {
    legacy: { queuedAt: 1200, viewedAt: null },
    current: { queuedAt: 1300, viewedAt: 1300 },
    timestamped: { queuedAt: 1400, viewedAt: 1500 }
  })
  assert.equal(DRAWER_REVIEW_QUEUE_STORAGE_KEY, 'closedai.drawer.reviewQueue')
})

test('enqueue keeps the first completion time; viewed and dequeue are idempotent', () => {
  let queue = enqueueDrawerReview({}, 'pane-a', 10)
  queue = enqueueDrawerReview(queue, 'pane-a', 20)
  assert.deepEqual(queue, { 'pane-a': { queuedAt: 10, viewedAt: null } })

  const viewed = markDrawerReviewViewed(queue, 'pane-a', 30)
  assert.equal(viewed['pane-a']?.viewedAt, 30)
  assert.equal(markDrawerReviewViewed(viewed, 'pane-a', 40), viewed)
  assert.equal(markDrawerReviewViewed(viewed, 'missing', 40), viewed)

  assert.deepEqual(dequeueDrawerReview(viewed, 'pane-a'), {})
  assert.equal(dequeueDrawerReview(viewed, 'missing'), viewed)
})

test('pruning removes entries for chats the store no longer lists', () => {
  const queue = {
    'pane-a': { queuedAt: 1, viewedAt: null },
    'pane-gone': { queuedAt: 2, viewedAt: null }
  }
  assert.deepEqual(pruneDrawerReviewQueue(queue, new Set(['pane-a'])), {
    'pane-a': { queuedAt: 1, viewedAt: null }
  })
  assert.equal(pruneDrawerReviewQueue(queue, new Set(['pane-a', 'pane-gone'])), queue)
})

test('only reviewed completions expire after the ten-minute inactivity grace period', () => {
  const queue = {
    unread: { queuedAt: 100, viewedAt: null },
    recent: { queuedAt: 200, viewedAt: 1_000 },
    expired: { queuedAt: 300, viewedAt: 500 }
  }

  assert.equal(nextDrawerReviewExpiry(queue), 500 + DRAWER_REVIEW_RETENTION_MS)
  assert.deepEqual(expireDrawerReviews(queue, 500 + DRAWER_REVIEW_RETENTION_MS), {
    unread: { queuedAt: 100, viewedAt: null },
    recent: { queuedAt: 200, viewedAt: 1_000 }
  })
})

test('every turn that finishes is reported, watched or not; fresh panes are not', () => {
  const prior = new Map([['pane-a', true], ['pane-b', true]])
  const peers = [peer('pane-a', false), peer('pane-b', false), peer('pane-new', false)]

  const result = reviewTransitions(prior, peers)
  assert.deepEqual(result.finished, ['pane-a', 'pane-b'])
  assert.deepEqual(result.runningAgain, [])
  assert.deepEqual([...result.nextRunning], [['pane-a', false], ['pane-b', false], ['pane-new', false]])
})

test('a pane that starts running again is reported so its queue entry can be dropped', () => {
  const prior = new Map([['pane-a', false]])
  const result = reviewTransitions(prior, [peer('pane-a', true)])
  assert.deepEqual(result.finished, [])
  assert.deepEqual(result.runningAgain, ['pane-a'])
})
