import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  bootstrapErrorBox,
  childProcessGoneLine,
  describeFault,
  faultDisposition,
  installCrashGuard,
  runBootstrap,
  type ChildProcessGone,
  type CrashGuardHost
} from './app-crash-guard.js'

function harness(hasWindow: boolean) {
  const process = new EventEmitter()
  const app = new EventEmitter()
  const exits: number[] = []
  const boxes: Array<{ title: string; content: string }> = []
  const lines: string[] = []
  const host: CrashGuardHost = {
    app: {
      on: (event, listener) => app.on(event, listener),
      exit: (code) => { exits.push(code ?? 0) }
    },
    process: { on: ((event: string, listener: (...args: unknown[]) => void) => process.on(event, listener)) as NodeJS.Process['on'] },
    showErrorBox: (title, content) => { boxes.push({ title, content }) },
    hasWindow: () => hasWindow,
    log: { error: (...args: unknown[]) => { lines.push(args.join(' ')) }, warn: (...args: unknown[]) => { lines.push(args.join(' ')) } }
  }
  return { host, process, app, exits, boxes, lines }
}

test('describeFault names the error, its message, and the first stack frame', () => {
  const error = new TypeError('bad thing')
  const text = describeFault(error)
  assert.match(text, /^TypeError: bad thing \(at /)
  assert.equal(describeFault(new Error('plain')).startsWith('plain ('), true)
  assert.equal(describeFault('text'), 'text')
  assert.equal(describeFault({ code: 7 }), '{"code":7}')
  assert.equal(describeFault(undefined), 'undefined')
})

test('only an uncaught exception before the window exists quits', () => {
  assert.equal(faultDisposition('uncaughtException', false), 'quit')
  assert.equal(faultDisposition('uncaughtException', true), 'continue')
  assert.equal(faultDisposition('unhandledRejection', false), 'continue')
  assert.equal(faultDisposition('unhandledRejection', true), 'continue')
})

test('the bootstrap error box is readable and says the app closes', () => {
  const box = bootstrapErrorBox(new Error('EACCES: permission denied, mkdir /root/x'))
  assert.equal(box.title, 'ClosedAI could not start')
  assert.match(box.content, /EACCES: permission denied/)
  assert.match(box.content, /The app will close/)
})

test('child-process-gone lines name the process kind, reason, and exit code', () => {
  const gpu: ChildProcessGone = { type: 'GPU', reason: 'crashed', exitCode: 133 }
  assert.equal(childProcessGoneLine(gpu), '[main] GPU process gone: crashed, exit code 133')
  const utility: ChildProcessGone = { type: 'Utility', reason: 'killed', name: 'network.mojom.NetworkService' }
  assert.equal(childProcessGoneLine(utility), '[main] Utility network.mojom.NetworkService process gone: killed')
})

test('a failed bootstrap shows the error box and exits with status 1', async () => {
  const { host, exits, boxes, lines } = harness(false)
  await runBootstrap(async () => { throw new Error('store is locked') }, host)
  assert.deepEqual(exits, [1])
  assert.equal(boxes.length, 1)
  assert.match(boxes[0]!.content, /store is locked/)
  assert.match(lines[0]!, /^\[main\] bootstrap failed/)
})

test('a successful bootstrap touches nothing', async () => {
  const { host, exits, boxes } = harness(false)
  await runBootstrap(async () => {}, host)
  assert.deepEqual(exits, [])
  assert.deepEqual(boxes, [])
})

test('after the window exists, uncaught faults are logged with the [main] prefix and the app continues', () => {
  const { host, process, exits, boxes, lines } = harness(true)
  installCrashGuard(host)
  process.emit('uncaughtException', new Error('late'), 'uncaughtException')
  process.emit('unhandledRejection', new Error('stray'), Promise.resolve())
  assert.deepEqual(exits, [])
  assert.deepEqual(boxes, [])
  assert.equal(lines.length, 2)
  assert.match(lines[0]!, /^\[main\] uncaught exception \(uncaughtException\), continuing: late/)
  assert.match(lines[1]!, /^\[main\] unhandled rejection, continuing: stray/)
})

test('before the window exists, an uncaught exception is shown and ends the app', () => {
  const { host, process, exits, boxes } = harness(false)
  installCrashGuard(host)
  process.emit('uncaughtException', new Error('early'), 'uncaughtException')
  assert.deepEqual(exits, [1])
  assert.match(boxes[0]!.content, /early/)
})

test('child process loss is logged through the app hook', () => {
  const { host, app, lines } = harness(true)
  installCrashGuard(host)
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'oom' })
  assert.deepEqual(lines, ['[main] GPU process gone: oom'])
})
