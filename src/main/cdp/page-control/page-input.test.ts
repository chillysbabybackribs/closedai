import assert from 'node:assert/strict'
import test from 'node:test'
import { CdpPageInput, type PageInputPage } from './page-input.ts'
import type { CdpCommandTarget } from './page-controller.ts'

type SeenCommand = { method: string; params: Record<string, unknown> }

function harness(evaluations: unknown[] = []) {
  const seen: SeenCommand[] = []
  const evaluated: string[] = []
  const target: CdpCommandTarget = {
    async command(method, params = {}) {
      seen.push({ method, params })
      if (method === 'Page.getLayoutMetrics') {
        return { cssVisualViewport: { clientWidth: 800, clientHeight: 600 } }
      }
      return {}
    }
  }
  const page: PageInputPage = {
    async click(ref) {
      evaluated.push(`click:${ref}`)
      return { ref, point: { x: 40, y: 30 }, coordinateSpace: 'main_viewport_css', hitTest: null }
    },
    async evaluateOnRef(ref, build) {
      evaluated.push(build('p1', ref))
      return evaluations.shift() as never
    }
  }
  return { seen, evaluated, input: new CdpPageInput(target, page) }
}

test('type focuses with a click, prepares the field, inserts once, and reads the value back', async () => {
  const { seen, evaluated, input } = harness([true, { value: 'hello world' }])
  const result = await input.type('p1:main:e2', 'hello world', true)
  assert.equal(evaluated[0], 'click:p1:main:e2')
  assert.match(evaluated[1]!, /function prepareType/)
  assert.match(evaluated[1]!, /true,"__closedaiPageControlV1"/)
  assert.match(evaluated[2]!, /function readValue/)
  assert.deepEqual(seen, [{ method: 'Input.insertText', params: { text: 'hello world' } }])
  assert.deepEqual(result, {
    ref: 'p1:main:e2',
    point: { x: 40, y: 30 },
    coordinateSpace: 'main_viewport_css',
    cleared: true,
    value: 'hello world'
  })
})

test('type omits the value when it cannot be read back', async () => {
  const { input } = harness([true, { value: null }])
  const result = await input.type('p1:main:e1', 'x', false)
  assert.equal(result.cleared, false)
  assert.equal('value' in result, false)
})

test('press_key sends Enter as keyDown with text plus keyUp', async () => {
  const { seen, input } = harness()
  const result = await input.pressKey('Enter', [])
  assert.deepEqual(seen.map((entry) => entry.method), ['Input.dispatchKeyEvent', 'Input.dispatchKeyEvent'])
  assert.deepEqual(seen[0]!.params, {
    type: 'keyDown', modifiers: 0, key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r'
  })
  assert.equal(seen[1]!.params.type, 'keyUp')
  assert.deepEqual(result, { key: 'Enter', code: 'Enter', modifiers: [] })
})

test('press_key builds shortcut chords without inserting text', async () => {
  const { seen, input } = harness()
  await input.pressKey('a', ['ctrl', 'shift'])
  assert.equal(seen[0]!.params.type, 'rawKeyDown')
  assert.equal(seen[0]!.params.modifiers, 2 + 8)
  assert.equal(seen[0]!.params.key, 'a')
  assert.equal(seen[0]!.params.code, 'KeyA')
  assert.equal('text' in seen[0]!.params, false)
})

test('press_key types plain characters with text and rejects unknown keys and modifiers', async () => {
  const { seen, input } = harness()
  await input.pressKey('?', [])
  assert.equal(seen[0]!.params.type, 'keyDown')
  assert.equal(seen[0]!.params.text, '?')
  await assert.rejects(() => input.pressKey('Bogus', []), /Unsupported key "Bogus"/)
  await assert.rejects(() => input.pressKey('a', ['hyper']), /Unknown modifier "hyper"/)
})

test('scroll with a ref scrolls it into view and reports frame offsets', async () => {
  const { seen, evaluated, input } = harness([{ scrollX: 0, scrollY: 480 }])
  const result = await input.scroll('p1:main:e3', 0, 0)
  assert.match(evaluated[0]!, /function scrollRef/)
  assert.deepEqual(seen, [])
  assert.deepEqual(result, { scrolled: 'into_view', ref: 'p1:main:e3', scrollX: 0, scrollY: 480 })
})

test('scroll without a ref wheels at the viewport center and requires a delta', async () => {
  const { seen, input } = harness()
  const result = await input.scroll(undefined, 0, 500)
  assert.deepEqual(seen.map((entry) => entry.method), ['Page.getLayoutMetrics', 'Input.dispatchMouseEvent'])
  assert.deepEqual(seen[1]!.params, {
    type: 'mouseWheel', x: 400, y: 300, button: 'none', buttons: 0, deltaX: 0, deltaY: 500
  })
  assert.deepEqual(result, { scrolled: 'wheel', point: { x: 400, y: 300 }, deltaX: 0, deltaY: 500 })
  await assert.rejects(() => input.scroll(undefined, 0, 0), /non-zero delta_x\/delta_y/)
})

test('a wheel the compositor never acknowledges fails fast instead of hanging the caller', async () => {
  const target: CdpCommandTarget = {
    async command(method) {
      if (method === 'Page.getLayoutMetrics') {
        return { cssVisualViewport: { clientWidth: 800, clientHeight: 600 } }
      }
      // A view that is not rendering never settles the wheel dispatch.
      return new Promise(() => {})
    }
  }
  const page: PageInputPage = {
    async click(ref) {
      return { ref, point: { x: 0, y: 0 }, coordinateSpace: 'main_viewport_css', hitTest: null }
    },
    async evaluateOnRef() { return undefined as never }
  }
  const input = new CdpPageInput(target, page, 20)
  await assert.rejects(
    () => input.scroll(undefined, 0, 400),
    /never acknowledged the wheel event/
  )
})
