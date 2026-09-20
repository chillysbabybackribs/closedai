import assert from 'node:assert/strict'
import test from 'node:test'
import { parseNativePdfTree } from './accessibility-text.js'
import { nativePdfReadScript } from './reader-script.js'

const tree = `rootWebArea
++staticText name='Viewer toolbar'
++pdfRoot name='PDF document containing 2 pages'
++++banner
++++++status name='Finished loading PDF'
++++region name='Page 1'
++++++paragraph
++++++++staticText name='First paragraph<newline>second line'
++++++++++inlineTextBox name='First paragraph'
++++++link name='Do not duplicate link names'
++++++++staticText name='link text'
++++region name='Page 2'
++++++paragraph
++++++++staticText name='Don't mistake quotes or <tags> for markup'
++staticText name='Outside PDF'`

test('native PDF text is scoped to a page and excludes toolbar, status, and inline duplicates', () => {
  const page = parseNativePdfTree(tree, 1, 2000)
  assert.equal(page.text, 'First paragraph\nsecond line\nlink text')
  assert.equal(page.totalPages, 2)
  assert.equal(page.pagesAvailable, 2)
  assert.equal(page.available, true)
  assert.equal(page.truncated, false)
  assert.equal(parseNativePdfTree(tree, 2, 2000).text, "Don't mistake quotes or <tags> for markup")
})

test('native PDF text distinguishes blank pages, unavailable pages, unsupported trees, and clipping', () => {
  const blank = parseNativePdfTree("pdfRoot name='PDF document containing 1 page'\n++region name='Page 1'\n++++image", 1, 100)
  assert.equal(blank.available, true)
  assert.equal(blank.text, '')
  assert.equal(parseNativePdfTree(tree, 3, 100).available, false)
  assert.equal(parseNativePdfTree("rootWebArea\n++staticText name='HTML'", 1, 100).hasPdfRoot, false)
  const clipped = parseNativePdfTree(tree, 1, 10)
  assert.equal(clipped.text, 'First para')
  assert.equal(clipped.truncated, true)
})

test('page ordinals do not depend on English region labels', () => {
  const localized = tree.replaceAll('Page ', 'Seite ').replace('PDF document containing 2 pages', 'PDF-Dokument mit 2 Seiten')
  assert.equal(parseNativePdfTree(localized, 2, 2000).text, parseNativePdfTree(tree, 2, 2000).text)
})

test('reader script filters response identity, bounds the result, and removes its listener', async () => {
  const listeners = new Set<(data: unknown) => void>()
  const cr = {
    addWebUiListener: (_name: string, fn: (data: unknown) => void) => { listeners.add(fn); return fn },
    removeWebUiListener: (fn: (data: unknown) => void) => { listeners.delete(fn) }
  }
  const chrome = { send: (name: string, args: unknown[]) => {
    assert.equal(name, 'requestWebContentsTree')
    assert.deepEqual(args, [{ processId: 7, routingId: 2, requestType: 'showOrRefreshTree', filters: { allow: 'name', allowEmpty: '', deny: '' } }])
    for (const listener of [...listeners]) {
      listener({ processId: 9, routingId: 2, tree: 'WRONG TARGET' })
      listener({ processId: 7, routingId: 2, tree })
    }
  } }
  const script = nativePdfReadScript(7, 2, 2, 30).replace("const cr = await import('chrome://resources/js/cr.js');", '')
  const result = await new Function('cr', 'chrome', `return ${script}`)(cr, chrome)
  assert.equal(result.page, 2)
  assert.equal(result.text.length, 30)
  assert.equal(result.truncated, true)
  assert.equal(listeners.size, 0)
})

test('reader script surfaces native errors and removes its listener', async () => {
  let listener: ((data: unknown) => void) | null = null
  const cr = {
    addWebUiListener: (_name: string, fn: (data: unknown) => void) => { listener = fn; return fn },
    removeWebUiListener: () => { listener = null }
  }
  const chrome = { send: () => listener?.({ processId: 7, routingId: 2, error: 'Document gone' }) }
  const script = nativePdfReadScript(7, 2, 1, 100).replace("const cr = await import('chrome://resources/js/cr.js');", '')
  await assert.rejects(new Function('cr', 'chrome', `return ${script}`)(cr, chrome), /Document gone/)
  assert.equal(listener, null)
})
