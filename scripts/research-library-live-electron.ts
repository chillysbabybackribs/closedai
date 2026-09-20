import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { ResearchLibrary } from '../src/main/research-library/service.js'
import { registerResearchLibraryIpc } from '../src/main/research-library/ipc.js'
import { registerInvoke } from '../src/main/ipc-register.js'
import { IPC } from '../src/shared/ipc-channels.js'

const root = process.env.CLOSEDAI_LIBRARY_CHECK_ROOT
if (!root) throw new Error('Run scripts/research-library-live-check.mjs')
app.setPath('userData', join(root, 'profile'))
const watchdog = setTimeout(() => { console.error('Research library check timed out'); app.exit(1) }, 30_000)

async function verify(directory: string) {
  await app.whenReady()
  const opened: string[] = []
  let requests = 0
  const library = ResearchLibrary.create(join(directory, 'library.json'), async () => {
    requests++
    return Response.json([{
      paperId: '2609.12345v2', title: 'Selective memory retrieval for coding agents',
      publicationDate: new Date(Date.now() - 86400000).toISOString(),
      abstract: 'We study retrieving relevant evidence only when needed. This fixture checks the saved abstract, source link, dismissal, and retrieval controls.'
    }])
  })
  registerResearchLibraryIpc(ipcMain, () => library)
  registerInvoke(ipcMain, IPC.invoke.browser.openTab, (_event, url) => { opened.push(url) })
  const window = new BrowserWindow({
    show: false, width: 1024, height: 900,
    webPreferences: { preload: join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true }
  })
  const errors: string[] = []
  window.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') errors.push(details.message)
  })
  async function evaluate<T>(expression: string): Promise<T> { return window.webContents.executeJavaScript(expression) }
  async function until(expression: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    throw new Error(`UI condition not reached: ${expression}`)
  }
  const control = (id: string) => `document.querySelector('[data-ui="${id}"]')`
  const click = (id: string) => evaluate(`${control(id)}.click()`)
  try {
    await window.loadFile(join(directory, 'web', 'fixture.html'))
    await until(`${control('research.refresh')} && !${control('research.refresh')}.disabled`)
    assert.equal(requests, 0, 'Opening the dialog must not fetch')
    await click('research.refresh')
    await until(`document.body.innerText.includes('1 saved paper') && !${control('research.refresh')}.disabled`)
    assert.equal(requests, 3)
    assert.equal((await library.search('memory retrieval')).results.length, 1)
    await click('research.paper-details')
    await click('research.paper-open')
    assert.deepEqual(opened, ['https://www.alphaxiv.org/abs/2609.12345'])
    const bounds = await evaluate<{ width: number; height: number; scroll: number; client: number }>(
      `(() => { const d = ${control('dialog.research-library')}; const b = document.querySelector('.research-library-body');
        const r = d.getBoundingClientRect(); return { width: r.width, height: r.height, scroll: b.scrollHeight, client: b.clientHeight }; })()`)
    assert.ok(bounds.width <= 800 && bounds.height <= 852)
    assert.ok(bounds.client > 200, 'Dialog body must have usable scroll space')
    await writeFile(join(directory, 'library.png'), (await window.webContents.capturePage()).toPNG())
    await click('research.paper-dismiss')
    await until(`document.body.innerText.includes('0 saved papers') && !${control('research.restore')}.disabled`)
    assert.equal((await library.search('memory retrieval')).results.length, 0)
    await click('research.restore')
    await until(`document.body.innerText.includes('1 saved paper') && !${control('research.refresh')}.disabled`)
    await click('research.enabled')
    await click('research.save')
    await until(`!${control('research.refresh')}.disabled`)
    await assert.rejects(library.read('2609.12345'), /disabled/)
    await window.loadFile(join(directory, 'web', 'fixture.html'))
    await until(`${control('research.enabled')} && document.body.innerText.includes('1 saved paper')`)
    assert.equal(await evaluate(`${control('research.enabled')}.checked`), false)
    assert.equal(requests, 3, 'Reopening must not fetch')
    assert.deepEqual(errors.filter((error) => !error.includes('Content-Security-Policy')), [])
    await writeFile(join(directory, 'result.json'), JSON.stringify({
      passed: true, requests, saved: 1, reopenedWithoutFetch: true,
      dismissalAndDisableVerified: true, bounds, screenshot: join(directory, 'library.png')
    }))
  } finally {
    clearTimeout(watchdog)
    library.dispose()
    window.destroy()
  }
}

void verify(root).then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1) })
