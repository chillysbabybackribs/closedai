import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { app, BrowserWindow } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { BrowserCdpAccess } from '../src/main/cdp/browser-cdp-access.js'

const profile = process.env.CLOSEDAI_SEARCH_CHECK_PROFILE
if (!profile) throw new Error('Run through scripts/cdp-frames-live-check.mjs')
app.setPath('userData', profile)
const watchdog = setTimeout(() => { console.error('CDP frames fixture exceeded forty seconds'); app.exit(1) }, 40_000)

type Requests = { childSessions: { capturing: number; failed: unknown[] }; requests: Array<{ url: string; sessionId?: string | null; requestId: string | null; source: string }> }
type Recording = { counts: Record<string, number>; frames: Array<{ sessionId: string; url: string; installed: boolean; counts?: Record<string, number> }> }
type Frames = { frames: Array<{ sessionId: string; url: string; onCurrentDocument?: string; error?: string }> }

// Two sites so the inner frames are out-of-process. The outer page adds its frame only after a
// delay, so the frame is created while the recorder is already hooked and must start paused.
function serve(host: string, bind: string, onRequest: (url: string) => void, nested: () => string): Promise<{ server: Server; base: string }> {
  const server = createServer((request, response) => {
    onRequest(request.url ?? '')
    if (request.url === '/api') { response.setHeader('content-type', 'application/json'); response.end('{"from":"' + request.headers.host + '"}'); return }
    if (request.url === '/worker.js') { response.setHeader('content-type', 'text/javascript'); response.end('fetch("/api").then(() => postMessage("done"))'); return }
    response.setHeader('content-type', 'text/html')
    if (request.url === '/outer') response.end(`<title>Outer</title><p>outer</p><script>
      fetch('/api');
      setTimeout(() => { const f = document.createElement('iframe'); f.src = ${JSON.stringify(nested() + '/middle')}; document.body.appendChild(f) }, 300)
    </script>`)
    else if (request.url === '/middle') response.end(`<title>Middle</title><p>middle</p><iframe src="${nested()}/inner"></iframe><script>fetch('/api'); new Worker('/worker.js')</script>`)
    else response.end('<title>Inner</title><p>inner</p><script>fetch("/api"); localStorage.setItem("k", "v")</script>')
  })
  return new Promise((resolve) => server.listen(0, bind, () => {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    resolve({ server, base: `http://${host}:${address.port}` })
  }))
}

async function verify(): Promise<void> {
  await app.whenReady()
  const hits: string[] = []
  let second = ''
  let third = ''
  // Three sites (host names, not ports, define a site) so both nested frames are out-of-process:
  // outer → middle is a child target of the page, middle → inner a child target of middle.
  const one = await serve('127.0.0.1', '127.0.0.1', (url) => hits.push(`one${url}`), () => second)
  const two = await serve('localhost', '127.0.0.1', (url) => hits.push(`two${url}`), () => third)
  const three = await serve('127.0.0.2', '127.0.0.2', (url) => hits.push(`three${url}`), () => '')
  second = two.base
  third = three.base
  const window = new BrowserWindow({ show: false, width: 1000, height: 700 })
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: 'about:blank' })
  browser.setBounds({ x: 0, y: 0, width: 1000, height: 700, visible: true })
  const cdp = new BrowserCdpAccess(() => browser)
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  try {
    const tabId = browser.tabList()[0]!.id
    // Hook and enable capture on a blank tab, before any frame exists.
    const hooked = await cdp.instrument(tabId, 'hook', { channels: ['fetch', 'storage'], capacity: 200, limit: 10 }) as Frames
    assert.deepEqual(hooked.frames, [], 'nothing to lease into yet')
    await cdp.networkRequests(tabId, { limit: 50 })
    await browser.navigate(`${one.base}/outer`)
    for (let i = 0; i < 100 && !hits.includes('three/api'); i++) await wait(100)
    await wait(800)

    const requests = await cdp.networkRequests(tabId, { limit: 100 }) as Requests
    const captured = requests.requests.filter((request) => request.url.endsWith('/api') && request.source !== 'timing')
    const sessions = new Set(captured.map((request) => request.sessionId ?? 'root'))
    assert.equal(requests.childSessions.capturing, 3, JSON.stringify(requests.childSessions))
    assert.equal(sessions.size, 4, `api requests captured from root, middle, inner and the worker: ${JSON.stringify(captured)}`)
    const workerRequest = captured.find((request) => request.sessionId && request.url.startsWith(two.base))
    assert.ok(workerRequest?.requestId)
    const body = await cdp.responseBody(tabId, workerRequest!.requestId!, workerRequest!.sessionId!) as { text?: string; sessionId?: string }
    assert.equal(body.sessionId, workerRequest!.sessionId)
    assert.match(body.text ?? '', /"from":"localhost/, 'a child-session body reads through its own session id')

    const recording = await cdp.instrument(tabId, 'recording', { channels: [], capacity: 200, limit: 10 }) as Recording
    assert.equal(recording.counts.fetch, 1, 'root recorded its own fetch')
    const middle = recording.frames.find((frame) => frame.url.endsWith('/middle'))
    const inner = recording.frames.find((frame) => frame.url.endsWith('/inner'))
    assert.equal(middle?.installed, true, JSON.stringify(recording.frames))
    assert.equal(middle?.counts?.fetch, 1, 'the late cross-origin frame was recorded from its first script')
    assert.equal(inner?.installed, true, JSON.stringify(recording.frames))
    assert.equal(inner?.counts?.fetch, 1, 'the nested frame auto-attached through its parent and was recorded')
    assert.equal(inner?.counts?.storage, 1)

    const unhooked = await cdp.instrument(tabId, 'unhook', { channels: [], capacity: 200, limit: 10 }) as Frames
    assert.equal(unhooked.frames.length, 2, JSON.stringify(unhooked.frames))
    assert.ok(unhooked.frames.every((frame) => !frame.error), JSON.stringify(unhooked.frames))
    const after = await cdp.instrument(tabId, 'recording', { channels: [], capacity: 200, limit: 10 }) as Recording
    assert.equal(after.frames.length, 0, 'released frames are no longer reported')
    console.log(JSON.stringify({ ok: true, childSessions: requests.childSessions, capturedSessions: sessions.size, frames: recording.frames.map((f) => [f.url.split('/').pop(), f.counts]) }))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    clearTimeout(watchdog)
    cdp.dispose()
    browser.dispose()
    window.destroy()
    for (const { server } of [one, two, three]) { server.closeAllConnections(); server.close() }
    app.exit(process.exitCode ? 1 : 0)
  }
}

void verify().catch((error: unknown) => { console.error(error); app.exit(1) })
