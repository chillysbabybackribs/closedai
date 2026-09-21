import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { BrowserWindow, WebContents } from 'electron'
import {
  RENDERER_RELOAD_WINDOW_MS,
  installRendererRecovery,
  rendererLossAction,
  rendererLossErrorBox
} from './main-window-recovery.js'

function harness() {
  const contents = new EventEmitter()
  let clock = 1_000
  let reloads = 0
  const boxes: string[] = []
  const lines: string[] = []
  const window = {
    isDestroyed: () => false,
    reload: () => { reloads += 1 },
    webContents: contents as unknown as WebContents
  } as unknown as BrowserWindow
  installRendererRecovery(window, {
    showErrorBox: (title, content) => { boxes.push(`${title}: ${content}`) },
    now: () => clock,
    log: { error: (line: string) => { lines.push(line) }, warn: (line: string) => { lines.push(line) } }
  })
  return {
    gone: (reason: string, exitCode?: number) => contents.emit('render-process-gone', {}, { reason, exitCode }),
    advance: (ms: number) => { clock += ms },
    contents,
    reloads: () => reloads,
    boxes,
    lines
  }
}

test('a clean exit is ignored, a first loss reloads, a repeat within a minute reports', () => {
  assert.equal(rendererLossAction('clean-exit', null, 5_000), 'ignore')
  assert.equal(rendererLossAction('crashed', null, 5_000), 'reload')
  assert.equal(rendererLossAction('oom', 5_000, 5_000 + RENDERER_RELOAD_WINDOW_MS - 1), 'report')
  assert.equal(rendererLossAction('oom', 5_000, 5_000 + RENDERER_RELOAD_WINDOW_MS), 'reload')
})

test('the error box names the reason and exit code', () => {
  const box = rendererLossErrorBox({ reason: 'oom', exitCode: 9 })
  assert.equal(box.title, 'ClosedAI window crashed')
  assert.match(box.content, /twice within a minute: oom \(exit code 9\)/)
  assert.match(rendererLossErrorBox({ reason: 'crashed' }).content, /: crashed\./)
})

test('the window reloads once and reports the second loss inside the window', () => {
  const h = harness()
  h.gone('crashed', 11)
  assert.equal(h.reloads(), 1)
  assert.deepEqual(h.boxes, [])
  h.advance(10_000)
  h.gone('crashed', 11)
  assert.equal(h.reloads(), 1)
  assert.equal(h.boxes.length, 1)
  assert.match(h.boxes[0]!, /crashed \(exit code 11\)/)
  assert.match(h.lines[0]!, /^\[main\] app window renderer gone: crashed \(exit code 11\); reloading$/)
  assert.match(h.lines[1]!, /; reporting$/)
})

test('a loss a minute after the last reload is treated as a fresh one', () => {
  const h = harness()
  h.gone('oom')
  h.advance(RENDERER_RELOAD_WINDOW_MS)
  h.gone('oom')
  assert.equal(h.reloads(), 2)
  assert.deepEqual(h.boxes, [])
})

test('clean exits and responsiveness changes only log', () => {
  const h = harness()
  h.gone('clean-exit')
  h.contents.emit('unresponsive')
  h.contents.emit('responsive')
  assert.equal(h.reloads(), 0)
  assert.deepEqual(h.lines, ['[main] app window renderer is unresponsive', '[main] app window renderer is responsive again'])
})
