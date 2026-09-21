import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { app, BrowserWindow, type WebContents } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { createHiddenPageWorker } from '../src/main/browser-workers/hidden-page-worker.js'

const root = process.env.CLOSEDAI_POPUP_CHECK_ROOT
if (!root) throw new Error('Run scripts/popup-tabs-live-check.mjs')
app.setPath('userData', join(root, 'profile'))
app.on('window-all-closed', () => {})
const watchdog = setTimeout(() => { console.error('Popup-tab check exceeded 45 seconds'); app.exit(1) }, 45_000)

async function until(predicate: () => boolean | Promise<boolean>, label: string) {
  const end = Date.now() + 5000
  while (Date.now() < end) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out: ${label}`)
}

async function check() {
  await app.whenReady()
  const requests: { url: string; method: string; body: string; referrer?: string }[] = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push({ url: request.url!, method: request.method!, body, referrer: request.headers.referer })
    if (request.url === '/authorize') {
      response.writeHead(302, { Location: '/callback' }).end()
      return
    }
    response.setHeader('content-type', 'text/html')
    response.end(`<!doctype html><title>${request.url}</title>
      <body style="margin:0;background:#246b45;color:white;font:24px sans-serif">
      <h1>Popup tab fixture ${request.url}</h1><input id="input">
      <a href="/background" id="background" style="display:block;width:250px;height:50px">Background tab</a>
      <form id="post" method="post" action="/posted" target="_blank"><input name="probe" value="preserved"></form>
      <script>window.messages=[];onmessage=e=>messages.push(e.data);
      if(location.pathname==='/callback') opener.postMessage('login-complete','*');</script>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const window = new BrowserWindow({ show: true, width: 1000, height: 800 })
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: 'about:blank' })
  const errors: unknown[] = []
  browser.on('error', (error) => errors.push(error))
  const evalPage = <T>(contents: Pick<WebContents, 'executeJavaScript'>, code: string): Promise<T> => contents.executeJavaScript(code, true)
  try {
    await browser.setBounds({ x: 0, y: 0, width: 1000, height: 750, visible: true })
    await browser.navigate(`${origin}/parent`)
    const parentId = browser.tabList()[0].id
    const parent = browser.contentsOf(parentId)!
    const childAfter = async (action: () => Promise<unknown>, expectedPath: string) => {
      const existing = new Set(browser.tabList().map((tab) => tab.id))
      await action()
      await until(() => browser.tabList().some((tab) => !existing.has(tab.id)), 'tab created')
      const info = browser.tabList().find((tab) => !existing.has(tab.id))!
      const contents = browser.contentsOf(info.id)!
      await until(() => contents.getURL().endsWith(expectedPath) && !contents.isLoading(), expectedPath)
      assert.equal(BrowserWindow.getAllWindows().length, 1, 'no native popup windows')
      assert.equal(browser.cdpTargetList().find((tab) => tab.id === info.id)?.kind, 'tab')
      assert.equal(browser.tabIdForContents(contents.id), info.id)
      return { id: info.id, contents }
    }

    const login = await childAfter(() => evalPage(parent,
      `window.login=window.open('/authorize','login','popup,width=400,height=300'); Boolean(login)`), '/callback')
    assert.equal(browser.tabList().find((tab) => tab.active)?.id, login.id)
    await until(() => evalPage(parent, `messages.includes('login-complete')`), 'login postMessage')
    assert.equal(await evalPage(login.contents, '!!window.opener'), true)
    // Popup geometry never overrides the browser pane, and standard screenshot/input access works.
    assert.equal(await evalPage(login.contents, 'innerWidth'), 1000)
    assert.deepEqual(browser.focusTabForInput(login.id), { activated: false })
    await evalPage(login.contents, `document.querySelector('#input').focus()`)
    login.contents.sendInputEvent({ type: 'char', keyCode: 'x' })
    await until(() => evalPage(login.contents, `document.querySelector('#input').value === 'x'`), 'tab input')
    const screenshot = await login.contents.capturePage()
    assert.ok(!screenshot.isEmpty(), 'popup paints in tab')
    assert.equal(screenshot.getSize().width, 1000)

    const blank = await childAfter(() => evalPage(parent,
      `window.blank=window.open('about:blank','blank','width=400'); blank.document.write('<title>Written child</title><p>retained</p>'); true`), 'about:blank')
    assert.equal(await evalPage(blank.contents, 'document.body.innerText'), 'retained')
    await evalPage(parent, `blank.location.href='/retargeted'`)
    await until(() => blank.contents.getURL().endsWith('/retargeted') && !blank.contents.isLoading(), 'blank retarget')
    assert.equal(await evalPage(blank.contents, '!!opener'), true)
    const count = browser.tabList().length
    await evalPage(parent, `window.reused=window.open('/reused','blank'); reused===blank`)
    await until(() => blank.contents.getURL().endsWith('/reused') && !blank.contents.isLoading(), 'named reuse')
    assert.equal(browser.tabList().length, count)

    const crossOrigin = `http://localhost:${address.port}/authorize`
    const cross = await childAfter(() => evalPage(parent,
      `window.cross=window.open(${JSON.stringify(crossOrigin)},'cross','width=400'); true`), '/callback')
    await until(() => evalPage(parent, `messages.filter(m=>m==='login-complete').length===2`), 'cross-origin postMessage')
    assert.equal(await evalPage(cross.contents, '!!opener'), true)

    const isolated = await childAfter(() => evalPage(parent,
      `window.open('/isolated','isolated','noopener,noreferrer,width=400')===null`), '/isolated')
    assert.equal(await evalPage(isolated.contents, 'opener===null'), true, 'explicit opener isolation survives')
    assert.equal(requests.find((request) => request.url === '/isolated')?.referrer, undefined)
    browser.closeTab(isolated.id)

    const nested = await childAfter(() => evalPage(login.contents,
      `window.nested=window.open('/nested','nested','width=350'); true`), '/nested')
    assert.equal(await evalPage(nested.contents, 'opener.location.pathname'), '/callback')
    await evalPage(login.contents, 'nested.close()')
    await until(() => !browser.tabList().some((tab) => tab.id === nested.id), 'window.close reaps tab')

    const posted = await childAfter(() => evalPage(parent, `document.querySelector('#post').submit()`), '/posted')
    assert.equal(requests.find((request) => request.url === '/posted')?.method, 'POST')
    assert.equal(requests.find((request) => request.url === '/posted')?.body, 'probe=preserved')
    assert.equal(requests.filter((request) => request.url === '/posted').length, 1, 'POST is not replayed')
    assert.equal(requests.find((request) => request.url === '/posted')?.referrer, `${origin}/parent`)

    browser.selectTab(parentId)
    const point = await evalPage<{ x: number; y: number }>(parent, `(() => {
      const r=document.querySelector('#background').getBoundingClientRect();return {x:r.x+20,y:r.y+20};})()`)
    const background = await childAfter(async () => {
      parent.sendInputEvent({ type: 'mouseDown', button: 'middle', clickCount: 1, ...point })
      parent.sendInputEvent({ type: 'mouseUp', button: 'middle', clickCount: 1, ...point })
    }, '/background')
    assert.equal(browser.tabList().find((tab) => tab.active)?.id, parentId, 'background does not steal selection')
    assert.equal(requests.filter((request) => request.url === '/background').length, 1)

    const worker = createHiddenPageWorker()
    try {
      await worker.navigate(`${origin}/worker`)
      const before = browser.tabList().length
      const contents = worker.contents()!
      assert.equal(await evalPage(contents, `window.open('/authorize','blocked','width=400')===null`), true)
      assert.equal(browser.tabList().length, before)
      assert.equal(BrowserWindow.getAllWindows().length, 1)
    } finally { worker.dispose() }

    browser.closeTab(parentId)
    assert.ok(!login.contents.isDestroyed(), 'child tab outlives opener tab')
    for (const id of [login.id, blank.id, cross.id, posted.id, background.id]) browser.closeTab(id)
    assert.ok(errors.length === 0, `browser errors: ${errors.map(String).join(', ')}`)
    console.log(JSON.stringify({ passed: true, electron: process.versions.electron,
      checks: ['login-redirect', 'same-and-cross-origin-opener', 'postMessage', 'pane-size', 'tab-input',
        'capture', 'blank-document-write', 'blank-retarget', 'named-reuse', 'nested-popup', 'window-close',
        'form-post-once', 'referrer', 'noopener-noreferrer', 'background-tab', 'worker-denial', 'outlives-opener', 'no-native-windows'] }))
  } finally {
    browser.dispose()
    window.destroy()
    server.close()
    clearTimeout(watchdog)
  }
}
void check().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1) })
