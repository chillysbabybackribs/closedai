import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import type { AppCommandHost } from '../app/host.js'
import type { PageVideoRequest } from '../../video-render/page-recorder.js'
import { mediaTools, type RecordPageVideo } from './index.js'

async function harness(record: RecordPageVideo) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'closedai-media-'))
  await writeFile(path.join(cwd, 'promo.html'), '<!doctype html><title>promo</title>')
  const calls: unknown[] = []
  const app = {
    state: (sections: readonly string[]) => (sections.includes('chat') ? { chat: { cwd } } : {}),
    selectedPaneId: () => 'pane-selected',
    browserTab: async (request: unknown, paneId: unknown) => { calls.push(['browserTab', request, paneId]); return { tabCount: 1 } }
  } as unknown as AppCommandHost
  const page = {
    navigate: async (url: string) => {
      calls.push(['navigate', url])
      return { ok: true as const, tabId: 'tab-video', ready: { url, title: 'promo.mp4', elapsedMs: 0, readyState: 'complete', reached: true, conditionMet: null } }
    }
  }
  const registry = new ToolRegistry([mediaTools({ app: () => app, ui: () => null, page: () => page as never, record })])
  const call = (args: Record<string, unknown>) => registry.call(
    { namespace: 'media', tool: 'video', arguments: args },
    { threadId: null, turnId: null, callId: 'media-call', paneId: 'pane-caller', source: 'exec' }
  )
  return { cwd, calls, call }
}

const json = (result: { content: Array<{ type: string; text?: string }> }) => JSON.parse(result.content[0]!.type === 'text' ? result.content[0]!.text! : '{}')

test('render records the page, then opens the finished video in a tab claimed by the caller', async () => {
  const requests: PageVideoRequest[] = []
  const { cwd, calls, call } = await harness(async (request, _signal, onFrame) => {
    requests.push(request)
    onFrame(15, 15)
    return { frames: 15, bytes: 4096 }
  })
  const view = json(await call({ action: 'render', path: 'promo.html', duration_s: 0.5, width: 1279, height: 720 }))
  assert.equal(view.state, 'completed')
  assert.equal(view.bytes, 4096)
  assert.equal(view.output, path.join(cwd, 'promo.mp4'))
  assert.equal(view.opened.tabId, 'tab-video')
  assert.deepEqual(
    { width: requests[0]!.width, height: requests[0]!.height, fps: requests[0]!.fps, durationMs: requests[0]!.durationMs },
    { width: 1280, height: 720, fps: 30, durationMs: 500 }
  )
  assert.match(requests[0]!.url, /^file:\/\/.*promo\.html$/)
  assert.deepEqual(calls.map((entry) => (entry as unknown[])[0]), ['navigate', 'browserTab'])
  assert.match((calls[0] as [string, string])[1], /promo\.mp4$/)
  assert.deepEqual((calls[1] as unknown[]).slice(1), [{ op: 'claim', tabId: 'tab-video' }, 'pane-caller'])
})

test('a long render returns progress, refuses a second render, and cancels without output', async () => {
  let release = (): void => {}
  const { call } = await harness((_request, signal, onFrame) => new Promise((resolve, reject) => {
    onFrame(3, 30)
    release = () => resolve({ frames: 30, bytes: 1 })
    signal.addEventListener('abort', () => reject(new Error('Render cancelled')))
  }))
  const first = json(await call({ action: 'render', path: 'promo.html', duration_s: 1, wait_s: 0, open: false }))
  assert.equal(first.state, 'rendering')
  assert.equal(first.framesDone, 3)
  assert.equal(first.percent, 10)
  const second = await call({ action: 'render', path: 'promo.html', duration_s: 1, wait_s: 0 })
  assert.equal(second.isError, true)
  assert.match(second.content[0]!.type === 'text' ? second.content[0]!.text : '', /still running/)
  const cancelled = json(await call({ action: 'cancel', job_id: first.jobId }))
  assert.equal(cancelled.state, 'cancelled')
  release()
})

test('status waits for completion and a failed render is an error with the reason', async () => {
  let fail = (_error: Error): void => {}
  const { call } = await harness(() => new Promise((_resolve, reject) => { fail = reject }))
  const started = json(await call({ action: 'render', path: 'promo.html', duration_s: 1, wait_s: 0 }))
  setTimeout(() => fail(new Error('ffmpeg exited with 1: bad audio')), 10)
  const status = await call({ action: 'status', job_id: started.jobId, wait_s: 5 })
  assert.equal(status.isError, true)
  assert.equal(json(status).state, 'failed')
  assert.match(json(status).error, /bad audio/)
})

test('render and play keep files inside the chat cwd and check their types', async () => {
  const { cwd, call } = await harness(async () => ({ frames: 1, bytes: 1 }))
  const outside = await call({ action: 'render', path: '../promo.html', duration_s: 1 })
  assert.match(outside.content[0]!.type === 'text' ? outside.content[0]!.text : '', /inside the chat working directory/)
  const wrongOutput = await call({ action: 'render', path: 'promo.html', duration_s: 1, output: 'promo.gif' })
  assert.match(wrongOutput.content[0]!.type === 'text' ? wrongOutput.content[0]!.text : '', /must end in \.mp4/)
  const notVideo = await call({ action: 'play', path: 'promo.html' })
  assert.match(notVideo.content[0]!.type === 'text' ? notVideo.content[0]!.text : '', /\.mp4 or \.webm/)
  await writeFile(path.join(cwd, 'clip.webm'), 'x')
  const played = json(await call({ action: 'play', path: 'clip.webm' }))
  assert.equal(played.tabId, 'tab-video')
})
