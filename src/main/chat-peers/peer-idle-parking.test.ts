import assert from 'node:assert/strict'
import test from 'node:test'
import { PeerIdleParking, type ParkablePeer } from './peer-idle-parking.js'
import type { ChatSurface } from '../chat-hub.js'
import type { ChatSnapshot } from '../../shared/chat.js'

function fakeSurface(overrides: { activeTurnId?: string | null; runningBackground?: boolean } = {}): ChatSurface {
  let running = overrides.runningBackground ?? false
  let turn = overrides.activeTurnId ?? null
  const stopped: string[] = []
  const started: string[] = []
  return {
    snapshot: () => ({ activeTurnId: turn } as ChatSnapshot),
    hasRunningBackground: () => running,
    start: async () => { started.push('start') },
    stop: () => { stopped.push('stop') },
    send: async () => {},
    interrupt: async () => {},
    selectModel: async () => {},
    selectReasoningEffort: async () => {},
    refreshPlanUsage: async () => {},
    listThreads: async () => [],
    readThread: async () => ({ threadId: '1', threadName: null, items: [] }),
    newThread: async () => {},
    continueInNewThread: async () => {},
    openThread: async () => {},
    archiveThread: async () => {},
    compactConversation: async () => {},
    beginLogin: async () => null,
    on: () => {},
    get _stopped() { return stopped },
    get _started() { return started },
    set _running(v: boolean) { running = v },
    set _turn(t: string | null) { turn = t }
  } as unknown as ChatSurface & { _stopped: string[]; _started: string[]; _running: boolean; _turn: string | null }
}

test('idle parking does not schedule when background tasks are active', () => {
  const surface = fakeSurface({ runningBackground: true })
  const peer: ParkablePeer = { surface, idleTimer: null, parked: false }
  const parking = new PeerIdleParking(() => peer, () => 'pane-selected', 50, 100)

  parking.schedule('pane-other')
  assert.equal(peer.idleTimer, null, 'parking timer should not be armed while background tasks run')
})

test('idle parking aborts stop if background tasks start before timer expires', async () => {
  const surface = fakeSurface({ runningBackground: false })
  const peer: ParkablePeer = { surface, idleTimer: null, parked: false }
  const parking = new PeerIdleParking(() => peer, () => 'pane-selected', 30, 100)

  parking.schedule('pane-other')
  assert.notEqual(peer.idleTimer, null, 'timer armed')

  // Background task starts mid-timer
  surface._running = true

  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(peer.parked, false)
  assert.deepEqual(surface._stopped, [])
})

test('idle parking stops surface and parks when completely idle', async () => {
  const surface = fakeSurface({ runningBackground: false })
  const peer: ParkablePeer = { surface, idleTimer: null, parked: false }
  const parking = new PeerIdleParking(() => peer, () => 'pane-selected', 30, 100)

  parking.schedule('pane-other')
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(peer.parked, true)
  assert.deepEqual(surface._stopped, ['stop'])

  // Waking the parked pane restarts it
  await parking.wake('pane-other')
  assert.equal(peer.parked, false)
  assert.deepEqual(surface._started, ['start'])
})
