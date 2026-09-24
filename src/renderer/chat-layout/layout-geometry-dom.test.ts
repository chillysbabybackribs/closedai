import assert from 'node:assert/strict'
import test from 'node:test'
import { dockPane, layoutGeometry } from './layout-tree.ts'
import { applyLayoutGeometryDom } from './layout-geometry-dom.ts'

test('applyLayoutGeometryDom sets tile and divider inline geometry', () => {
  type Style = { left: string; top: string; width: string; height: string }
  const styles = new Map<string, Style>()
  const styleFor = (key: string): Style => {
    let row = styles.get(key)
    if (!row) {
      row = { left: '', top: '', width: '', height: '' }
      styles.set(key, row)
    }
    return row
  }
  const node = (key: string, attrs: Record<string, string>): HTMLElement => ({
    style: styleFor(key),
    getAttribute(name: string) { return attrs[name] ?? null }
  }) as unknown as HTMLElement
  const tileA = node('a', { 'data-pane-id': 'a' })
  const tileB = node('b', { 'data-pane-id': 'b' })
  const divider = node('div', { 'data-ui': 'layout.divider', 'data-ui-key': 'ab' })
  const canvas = {
    querySelector(selector: string): HTMLElement | null {
      if (selector.includes('data-pane-id="a"')) return tileA
      if (selector.includes('data-pane-id="b"')) return tileB
      if (selector.includes('data-ui-key="ab"')) return divider
      return null
    }
  } as unknown as HTMLElement
  const tree = dockPane({ kind: 'pane', id: 'a' }, 'b', 'a', 'right', 'ab')
  applyLayoutGeometryDom(canvas, layoutGeometry(tree, 800, 600))
  assert.equal(styleFor('a').width, `${layoutGeometry(tree, 800, 600).panes[0]!.rect.width}px`)
  assert.equal(styleFor('div').left, `${layoutGeometry(tree, 800, 600).dividers[0]!.rect.x}px`)
})

test('split resize coalesces moves and flushes release/cancel before clearing live state', async () => {
  const { createSplitResizeSession } = await import('./layout-split-resize.ts')
  const callbacks = new Map<number, FrameRequestCallback>()
  let id = 0
  const originalRequest = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id }
  globalThis.cancelAnimationFrame = (key) => { callbacks.delete(key) }
  try {
    const painted: number[] = []
    const session = createSplitResizeSession(() => {
      assert.equal(session.live.active, true)
      painted.push(session.live.ratio!.ratio)
    })
    session.begin()
    session.move('split', 0.6)
    session.move('split', 0.7)
    assert.equal(callbacks.size, 1)
    session.end()
    assert.deepEqual(painted, [0.7])
    assert.equal(callbacks.size, 0)
    assert.deepEqual(session.live, { active: false, ratio: null })
    session.begin()
    session.move('split', 0.8)
    const [key, callback] = [...callbacks][0]!
    callbacks.delete(key)
    callback(0)
    // Escape/lost capture restores even though React's committed ratio never changed.
    session.move('split', 0.5)
    session.end()
    assert.deepEqual(painted, [0.7, 0.8, 0.5])
    assert.equal(callbacks.size, 0)
    session.end()
    assert.equal(painted.length, 3)
  } finally {
    globalThis.requestAnimationFrame = originalRequest
    globalThis.cancelAnimationFrame = originalCancel
  }
})
