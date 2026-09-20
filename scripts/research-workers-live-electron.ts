import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { app, BrowserWindow, session } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { RESEARCH_PARTITION } from '../src/main/browser-workers/hidden-page-worker.js'
import { createResearchRuntime } from '../src/main/research-runtime.js'
import { ToolRegistry } from '../src/main/tools/registry.js'
import type { ResearchSnapshot } from '../src/shared/web-research.js'

const profile = process.env.CLOSEDAI_SEARCH_CHECK_PROFILE
if (!profile) throw new Error('Run through scripts/research-workers-live-check.mjs')
app.setPath('userData', profile)
const watchdog = setTimeout(() => { console.error('Research worker fixture exceeded forty seconds'); app.exit(1) }, 40_000)

// A client-rendered shell: the static body is empty, the text arrives from script after a
// timer, and the cookie tells the fixture which session loaded it.
const SHELL = `<!doctype html><title>Shell</title><div id="root"></div>
<script>setTimeout(() => { document.getElementById('root').innerText = 'Rendered evidence ' + (document.cookie || 'no-cookie') }, 150)</script>`
const SPARSE = `<!doctype html><title>Sparse</title><div id="root">Loading…</div>
<script>setTimeout(() => { document.getElementById('root').innerText = 'Hydrated evidence' }, 150)</script>`

async function verify(profile: string): Promise<void> {
  await app.whenReady()
  const hits: string[] = []
  const server = createServer((request, response) => {
    hits.push(`${request.url} ${request.headers.cookie ?? ''}`.trim())
    if (request.url === '/redirect') { response.writeHead(302, { location: '/static' }); response.end(); return }
    response.setHeader('content-type', 'text/html')
    if (request.url === '/shell') response.end(SHELL)
    else if (request.url === '/sparse') response.end(SPARSE)
    else if (request.url === '/popup') response.end('<body><p>Popup source</p><script>window.open("/static")</script></body>')
    else response.end('<title>Static</title><main>Static evidence</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  // A user login on the normal browser session must never reach a worker.
  await session.fromPartition('persist:browser').cookies.set({ url: base, name: 'login', value: 'user-secret' })
  const window = new BrowserWindow({ show: false, width: 1000, height: 700 })
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: 'about:blank' })
  const runtime = await createResearchRuntime({
    libraryPath: join(profile, 'research-library.json'),
    root: join(profile, 'research-runs'), browser: () => browser, workspace: () => profile,
    peers: () => ({ paneSnapshot: () => ({ threadId: 'thread', activeTurnId: 'turn' }) }) as never
  })
  try {
    const context = { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal }
    const registry = new ToolRegistry([runtime.namespace])
    const result = await registry.call({ namespace: 'search', tool: 'run', arguments: {
      action: 'start', presentation: 'background', urls: [`${base}/shell`, `${base}/sparse`, `${base}/redirect`, `${base}/popup`]
    } }, context)
    assert.equal(result.isError, undefined)
    const run = JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '') as ResearchSnapshot
    for (let i = 0; i < 400 && runtime.service.read(run.runId, context).state === 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const final = runtime.service.read(run.runId, context)
    assert.equal(final.state, 'completed')
    const byPath = Object.fromEntries(final.sources.map((source) => [new URL(source.url).pathname, source]))
    assert.equal(byPath['/shell']?.state, 'ready', JSON.stringify(byPath['/shell']))
    assert.equal(byPath['/shell']?.representation, 'rendered_text')
    assert.equal(byPath['/sparse']?.state, 'ready', JSON.stringify(byPath['/sparse']))
    assert.equal(byPath['/sparse']?.representation, 'rendered_text')
    // Electron's fetch leaves Response.url empty, so a followed redirect keeps the requested URL.
    const redirected = byPath['/static'] ?? byPath['/redirect']
    assert.equal(redirected?.state, 'ready', JSON.stringify(redirected))
    assert.equal(redirected?.representation, 'static_text')
    assert.ok(hits.some((hit) => hit.startsWith('/static')), 'the redirect was followed')
    assert.equal(byPath['/popup']?.representation, 'rendered_text', JSON.stringify(byPath['/popup']))
    const excerpt = async (id: string) => (await runtime.service.source(run.runId, id, context, 0, 500) as { text: string; representation: string })
    const shell = await excerpt(byPath['/shell']!.id)
    assert.equal(shell.text, 'Rendered evidence no-cookie', 'script ran in the hidden worker without the user session cookie')
    assert.equal(shell.representation, 'rendered_text')
    assert.equal((await excerpt(byPath['/sparse']!.id)).text, 'Hydrated evidence')
    assert.equal((await excerpt(redirected!.id)).text, 'Static evidence')
    assert.equal((await excerpt(byPath['/popup']!.id)).text, 'Popup source')
    assert.ok(hits.every((hit) => !hit.includes('user-secret')), `no request carried the user cookie: ${hits.join(' | ')}`)
    assert.equal(browser.tabList().length, 1, 'workers and their popups never enter the tab strip')
    console.log(JSON.stringify({ ok: true, partition: RESEARCH_PARTITION, sources: final.sources.map((s) => [new URL(s.url).pathname, s.state, s.representation, s.chars]), hits }))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    clearTimeout(watchdog)
    runtime.dispose()
    runtime.library.dispose()
    browser.dispose()
    window.destroy()
    server.closeAllConnections()
    server.close()
    app.exit(process.exitCode ? 1 : 0)
  }
}

void verify(profile).catch((error: unknown) => { console.error(error); app.exit(1) })
