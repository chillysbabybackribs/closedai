import assert from 'node:assert/strict'
import test from 'node:test'
import { CdpPageAgent, type CdpCommandTarget } from './page-agent.ts'
import type { LocalInspection } from './runtime.ts'

type SeenCommand = { method: string; params: Record<string, unknown> }

function localInspection(elements: LocalInspection['elements'] = [], width = 800, height = 600): LocalInspection {
  return {
    viewport: { width, height, deviceScaleFactor: 2, scrollX: 0, scrollY: 40 },
    elements,
    candidateCount: elements.length
  }
}

function snapshotId(expression: string): string {
  const match = expression.match(/\("(p[0-9a-f]+)","/)
  assert.ok(match)
  return match[1]!
}

test('inspect returns labelled main-viewport coordinates and click re-resolves its ref', async () => {
  const seen: SeenCommand[] = []
  let ref = ''
  const target: CdpCommandTarget = {
    async command(method, params = {}) {
      seen.push({ method, params })
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'main', url: 'https://closed.ai/' } } }
      }
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 }
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression)
        if (expression.includes('function inspectFrame')) {
          ref = `${snapshotId(expression)}:main:e1`
          return { result: { value: localInspection([{
            ref,
            frameId: 'main',
            tag: 'button',
            role: 'button',
            name: 'Continue',
            bounds: { x: 10, y: 20, width: 100, height: 40 },
            center: { x: 60, y: 40 },
            quad: [10, 20, 110, 20, 110, 60, 10, 60],
            quadSource: 'client_rect',
            visible: true,
            hitTestable: true,
            disabled: false
          }]) } }
        }
        return { result: { value: { point: { x: 60, y: 40 }, viewport: { width: 800, height: 600 } } } }
      }
      if (method === 'DOM.getNodeForLocation') return { backendNodeId: 17, frameId: 'main' }
      if (method === 'Input.dispatchMouseEvent') return {}
      throw new Error(`Unexpected ${method}`)
    }
  }
  const agent = new CdpPageAgent(target)
  const inspection = await agent.inspect(200)
  assert.equal(inspection.coordinateSpace, 'main_viewport_css')
  assert.deepEqual(inspection.viewport, {
    width: 800, height: 600, deviceScaleFactor: 2, scrollX: 0, scrollY: 40
  })
  assert.deepEqual(inspection.elements[0]?.center, { x: 60, y: 40 })

  const click = await agent.click(ref)
  assert.deepEqual(click.point, { x: 60, y: 40 })
  assert.deepEqual(click.hitTest, { backendNodeId: 17, frameId: 'main' })
  assert.equal(seen.filter((entry) => entry.method === 'Input.dispatchMouseEvent').length, 3)
})

test('inspect normalizes child-frame geometry through its owner content quad', async () => {
  const seen: SeenCommand[] = []
  const target: CdpCommandTarget = {
    async command(method, params = {}) {
      seen.push({ method, params })
      if (method === 'Page.getFrameTree') {
        return { frameTree: {
          frame: { id: 'main', url: 'https://closed.ai/' },
          childFrames: [{ frame: { id: 'child', parentId: 'main', url: 'https://frame.test/' } }]
        } }
      }
      if (method === 'Page.createIsolatedWorld') {
        return { executionContextId: params.frameId === 'main' ? 1 : 2 }
      }
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression)
        if (expression.includes('function prepareClick')) {
          return { result: { value: { point: { x: 20, y: 15 }, viewport: { width: 100, height: 50 } } } }
        }
        const id = snapshotId(expression)
        if (params.contextId === 1) return { result: { value: localInspection([]) } }
        return { result: { value: localInspection([{
          ref: `${id}:child:e1`,
          frameId: 'child',
          tag: 'a',
          role: 'link',
          name: 'Inside frame',
          bounds: { x: 10, y: 10, width: 20, height: 10 },
          center: { x: 20, y: 15 },
          quad: [10, 10, 30, 10, 30, 20, 10, 20],
          quadSource: 'client_rect',
          visible: true,
          hitTestable: true,
          disabled: false
        }], 100, 50) } }
      }
      if (method === 'DOM.getFrameOwner') return { backendNodeId: 9 }
      if (method === 'DOM.resolveNode') return { object: { objectId: 'owner-9' } }
      if (method === 'Runtime.callFunctionOn') {
        if (String(params.functionDeclaration).includes('scrollIntoView')) return { result: { value: true } }
        return { result: { value: [200, 100, 400, 100, 400, 200, 200, 200] } }
      }
      if (method === 'Runtime.releaseObject') return {}
      if (method === 'DOM.getNodeForLocation') return { backendNodeId: 4, frameId: 'child' }
      if (method === 'Input.dispatchMouseEvent') return {}
      throw new Error(`Unexpected ${method}`)
    }
  }
  const agent = new CdpPageAgent(target)
  const inspection = await agent.inspect(20)
  assert.deepEqual(inspection.elements[0]?.center, { x: 240, y: 130 })
  assert.deepEqual(inspection.elements[0]?.bounds, { x: 220, y: 120, width: 40, height: 20 })
  assert.equal(inspection.elements[0]?.frameId, 'child')
  const click = await agent.click(inspection.elements[0]!.ref)
  assert.deepEqual(click.point, { x: 240, y: 130 })
  assert.equal(seen.some((entry) =>
    entry.method === 'Runtime.callFunctionOn' && String(entry.params.functionDeclaration).includes('scrollIntoView')
  ), true)
})

test('click_at hit-tests before input and rejects points outside the viewport', async () => {
  const seen: string[] = []
  const target: CdpCommandTarget = {
    async command(method) {
      seen.push(method)
      if (method === 'Page.getLayoutMetrics') {
        return { cssVisualViewport: { clientWidth: 640, clientHeight: 480, pageX: 0, pageY: 10 } }
      }
      if (method === 'DOM.getNodeForLocation') return { backendNodeId: 3 }
      if (method === 'Input.dispatchMouseEvent') return {}
      throw new Error(`Unexpected ${method}`)
    }
  }
  const agent = new CdpPageAgent(target)
  await assert.rejects(() => agent.clickAt({ x: 640, y: 20 }), /outside the 640×480 main viewport/)
  assert.deepEqual(seen, ['Page.getLayoutMetrics'])
  const result = await agent.clickAt({ x: 12.5, y: 20 })
  assert.deepEqual(result.point, { x: 12.5, y: 20 })
  assert.deepEqual(seen.slice(1), [
    'Page.getLayoutMetrics', 'DOM.getNodeForLocation',
    'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent'
  ])
})
