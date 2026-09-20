import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { registerBrowserCoreIpc } from '../src/main/browser-core-ipc.js'
import { registerLocalFilesIpc } from '../src/main/local-files/ipc.js'
import { IPC } from '../src/shared/ipc-channels.js'

const root = process.env.CLOSEDAI_IMAGE_CHECK_ROOT
if (!root) throw new Error('Run scripts/image-tabs-live-check.mjs')
app.setPath('userData', join(root, 'profile'))
app.on('window-all-closed', () => {})
const watchdog = setTimeout(() => { console.error('Image-tab check exceeded 45 seconds'); app.exit(1) }, 45_000)

async function check(root: string) {
  await app.whenReady()
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end('<title>Preserved web page</title><body style="background:#bc3030;height:4000px"><input id="draft"><h1>Native web page</h1></body>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const window = new BrowserWindow({ show: false, width: 1280, height: 850,
    webPreferences: { preload: join(root, 'preload.cjs'), backgroundThrottling: false } })
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error('Fixture renderer:', message)
  })
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: 'about:blank' })
  registerBrowserCoreIpc(ipcMain, () => browser)
  registerLocalFilesIpc(ipcMain, () => browser)
  ipcMain.handle(IPC.invoke.browserDownloads.list, () => [])
  browser.on('state', (state) => window.webContents.send(IPC.event.browserState, state))
  browser.on('tabs', (tabs) => window.webContents.send(IPC.event.browserTabs, tabs))
  const evaluate = async <T>(code: string): Promise<T> => {
    try { return await window.webContents.executeJavaScript(code) }
    catch (cause) { throw new Error(`Renderer evaluation failed: ${code}`, { cause }) }
  }
  async function until(code: string) {
    const end = Date.now() + 5000
    while (Date.now() < end) {
      if (await evaluate<boolean>(code)) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out: ${code}`)
  }
  const path = '/tmp/closedai-image-tab-check.png'
  try {
    // A large inert image makes zoom/pan measurable. Use the user's mockup for optional visual QA.
    const mockup = process.env.CLOSEDAI_IMAGE_CHECK_IMAGE
    const image = mockup ? nativeImage.createFromPath(mockup) : nativeImage.createFromBitmap(
      Buffer.alloc(1600 * 1000 * 4, 180), { width: 1600, height: 1000 })
    assert.ok(!image.isEmpty())
    await writeFile(path, image.toPNG())
    await window.loadFile(join(root, 'index.html'))
    await until('document.querySelector("[data-ui=\"chat.local-file\"]") !== null')
    await browser.navigate(`http://127.0.0.1:${address.port}`)
    const webId = browser.tabList()[0].id
    const contents = browser.contentsOf(webId)!
    await contents.executeJavaScript('window.probeToken = "retained"; document.querySelector("#draft").value = "unfinished"; window.scrollTo(0, 250)')
    await until('document.querySelector("#browser-page").getBoundingClientRect().height > 100')
    await evaluate('document.querySelector("[data-ui=\"chat.local-file\"]").click()')
    await until('document.querySelector(".image-viewer:not([hidden]) img")?.naturalWidth > 0')
    const imageId = browser.snapshot().image!.tabId
    assert.ok(imageId)
    assert.equal(browser.tabList().length, 2)
    assert.throws(() => browser.contentsOf(imageId), /image viewer tab/)
    assert.equal(browser.cdpTargetList().some((tab) => tab.id === imageId), false)
    assert.equal(window.contentView.children.length, 1, 'image tabs allocate no native view')
    const assertParked = () => {
      for (const view of window.contentView.children) {
        assert.ok(view.getBounds().x >= window.getContentBounds().width, 'native page is outside the window')
      }
    }
    assertParked()
    const geometry = await evaluate<{ width: number; height: number; frame: number }>(`(() => {
      const viewer = document.querySelector('.image-viewer:not([hidden])').getBoundingClientRect();
      return {width:viewer.width,height:viewer.height,frame:document.querySelector('.browser-frame').getBoundingClientRect().height};
    })()`)
    assert.ok(geometry.width > 500 && geometry.height > 500)
    assert.equal(geometry.height, geometry.frame)
    await evaluate('document.querySelector("[data-ui=\"image.actual-size\"]").click()')
    await until('document.querySelector(".image-viewer-scale").textContent === "100%"')
    await evaluate('document.querySelector(".image-viewer-stage").scrollLeft = 120')
    const pan = await evaluate<number>('document.querySelector(".image-viewer-stage").scrollLeft')
    assert.ok(pan > 0)
    browser.selectTab(webId)
    await until('document.querySelector(".image-viewer").hidden')
    assert.deepEqual(await contents.executeJavaScript('[window.probeToken, document.querySelector("#draft").value, window.scrollY]'),
      ['retained', 'unfinished', 250])
    browser.selectTab(imageId)
    await until('!document.querySelector(".image-viewer").hidden')
    assertParked()
    assert.equal(await evaluate('document.querySelector(".image-viewer-scale").textContent'), '100%')
    assert.equal(await evaluate('document.querySelector(".image-viewer-stage").scrollLeft'), pan)
    await evaluate('window.closedai.localFiles.open("/tmp/closedai-image-tab-check.png")')
    assert.equal(browser.tabList().length, 2, 'reopening selects existing tab')
    window.setSize(1400, 900)
    await until('window.innerWidth >= 1300')
    await new Promise((resolve) => setTimeout(resolve, 150))
    assertParked()
    await evaluate('document.querySelector("[data-ui=\"image.fit\"]").click()')
    await until('document.querySelector("[data-ui=\"image.fit\"]").getAttribute("aria-pressed") === "true"')
    await new Promise((resolve) => setTimeout(resolve, 100))
    await writeFile('/tmp/closedai-image-tab-verification.png', (await window.webContents.capturePage()).toPNG())
    browser.closeTab(imageId)
    assert.equal(browser.tabList().find((tab) => tab.active)?.id, webId)
    await until('document.querySelector(".image-viewer") === null')
    assert.ok(window.contentView.children[0].getBounds().x < window.getContentBounds().width)
    await writeFile(join(root, 'result.json'), JSON.stringify({ passed: true, checks: ['local-link-to-tab', 'native-view-parked', 'no-image-webcontents',
      'viewer-fills-pane', 'zoom-and-pan-retained', 'web-draft-and-scroll-retained', 'deduplicate', 'resize', 'close-restores-web'], geometry }))
  } finally {
    browser.dispose()
    window.destroy()
    server.close()
    await rm(path, { force: true })
    clearTimeout(watchdog)
  }
}

void check(root).then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1) })
