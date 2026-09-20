import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { app, BrowserWindow, nativeImage } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { UiCaptureAccess } from '../src/main/ui-capture-access.js'

const profile = process.env.CLOSEDAI_SEARCH_CHECK_PROFILE
if (!profile) throw new Error('Run through scripts/capture-coherence-live-check.mjs')
app.setPath('userData', profile)
const watchdog = setTimeout(() => { console.error('Capture coherence fixture exceeded forty seconds'); app.exit(1) }, 40_000)

// The page paints a colour chosen by the query and, when asked, keeps mutating its DOM.
const PAGE = `<!doctype html><title>Pixels</title><style>html,body{margin:0;height:100%}</style><body>
<script>
  const q = new URLSearchParams(location.search);
  document.body.style.background = q.get('color') || 'rgb(0,0,255)';
  window.recolor = (c) => { document.body.style.background = c; return document.visibilityState };
  if (q.get('churn')) setInterval(() => { document.body.appendChild(document.createElement('i')) }, 5);
</script></body>`

function centrePixel(dataUrl: string): [number, number, number] {
  const image = nativeImage.createFromDataURL(dataUrl)
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  const offset = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4
  // Electron bitmaps are BGRA.
  return [bitmap[offset + 2]!, bitmap[offset + 1]!, bitmap[offset]!]
}
const near = (pixel: [number, number, number], expected: [number, number, number]) => pixel.every((value, index) => Math.abs(value - expected[index]!) < 24)

async function verify(): Promise<void> {
  await app.whenReady()
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end(PAGE) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const window = new BrowserWindow({ show: true, width: 800, height: 600 })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: 'about:blank' })
  browser.setBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
  const capture = new UiCaptureAccess(() => window, () => browser)
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  try {
    // A blue page in a tab that then goes to the background behind a foreground tab.
    const hidden = browser.openNewTab(`${base}/?color=rgb(0,0,255)`, true)
    await wait(800)
    const foreground = browser.openNewTab(`${base}/?color=rgb(255,255,255)`, true)
    await wait(1_000)
    assert.equal(browser.tabList().find((tab) => tab.active)?.id, foreground)

    const first = await capture.captureBrowserPage(hidden, { until: 'load', timeoutMs: 5_000 })
    assert.ok(first?.image, JSON.stringify(first))
    assert.ok(near(centrePixel(first.image.dataUrl), [0, 0, 255]), `hidden tab captured blue: ${centrePixel(first.image.dataUrl)}`)
    assert.equal(first.coherence?.verdict, 'verified', JSON.stringify(first.coherence))
    assert.equal(first.coherence?.frame, 'settled', 'a hidden document cannot paint on request; its frame is proven by stability')
    assert.ok((first.coherence?.intervalMs ?? 9999) < 600, `no paint-probe timeout spent on a hidden tab: ${first.coherence?.intervalMs}ms`)

    // Change the hidden page's colour while it stays hidden; the next capture must show it.
    assert.equal(await browser.contentsOf(hidden)!.executeJavaScript('window.recolor("rgb(255,0,0)")', true), 'hidden')
    const second = await capture.captureBrowserPage(hidden, { until: 'load', timeoutMs: 5_000 })
    assert.ok(second?.image)
    assert.ok(near(centrePixel(second.image.dataUrl), [255, 0, 0]), `hidden tab recaptured red, not a stale blue frame: ${centrePixel(second.image.dataUrl)}`)
    assert.equal(second.coherence?.frame, 'settled', JSON.stringify(second.coherence))

    // A hidden page that keeps changing is delivered, but never as verified. The hidden compositor
    // coalesces rapid changes, so consecutive frames can still agree; the DOM observer is what
    // catches this case, and either signal is enough to withhold the verified verdict.
    await browser.contentsOf(hidden)!.executeJavaScript('window.__t = setInterval(() => window.recolor(`rgb(${Math.random()*255|0},0,0)`), 10)', true)
    const flickering = await capture.captureBrowserPage(hidden, { until: 'load', timeoutMs: 5_000 })
    await browser.contentsOf(hidden)!.executeJavaScript('clearInterval(window.__t)', true)
    assert.ok(flickering?.image)
    assert.notEqual(flickering.coherence?.verdict, 'verified', JSON.stringify(flickering.coherence))
    assert.ok((flickering.coherence?.domMutations ?? 0) > 0, JSON.stringify(flickering.coherence))

    // A page whose DOM keeps changing is delivered, but not as verified.
    await browser.navigate(`${base}/?color=rgb(0,255,0)&churn=1`)
    await wait(400)
    const churning = await capture.captureBrowserPage(undefined, { until: 'load', timeoutMs: 5_000 })
    assert.ok(churning?.image)
    assert.equal(churning.coherence?.verdict, 'dom_changing', JSON.stringify(churning.coherence))
    assert.equal(churning.coherence?.frame, 'painted', 'the visible tab paints on request')
    assert.ok((churning.coherence?.domMutations ?? 0) > 0)
    assert.ok(near(centrePixel(churning.image.dataUrl), [0, 255, 0]))
    console.log(JSON.stringify({ ok: true, hidden: first.coherence, recolored: second.coherence, flickering: flickering.coherence, churning: churning.coherence }))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    clearTimeout(watchdog)
    browser.dispose()
    window.destroy()
    server.closeAllConnections()
    server.close()
    app.exit(process.exitCode ? 1 : 0)
  }
}

void verify().catch((error: unknown) => { console.error(error); app.exit(1) })
