import type { AgentPageClick, AgentPageElement, AgentPageFrame, AgentPageInspection, ViewportPoint } from './types.js'
import {
  FRAME_OWNER_QUAD_FUNCTION,
  SCROLL_FRAME_OWNER_FUNCTION,
  inspectionExpression,
  prepareClickExpression,
  type LocalElement,
  type LocalInspection,
  type PreparedClick
} from './runtime.js'
import { errorMessage, mapIntoQuad, numberArray, numberOf, recordOf, stringOf } from './protocol-values.js'

const WORLD_NAME = 'closedai_agent_page_v1'
const COORDINATE_SPACE = 'main_viewport_css' as const

export type CdpCommandTarget = {
  command(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>
}

type FrameNode = { id: string; parentId: string | null; url: string }
type FrameInspection = {
  frame: FrameNode
  contextId: number
  local: LocalInspection
}
type SnapshotState = {
  id: string
  rootFrameId: string
  frames: Map<string, FrameNode>
  inspected: Map<string, FrameInspection>
  refs: Map<string, FrameInspection>
}

/** Agent-oriented DOM geometry and input built only from CDP commands. */
export class CdpPageController {
  private snapshot: SnapshotState | null = null

  constructor(private readonly target: CdpCommandTarget) {}

  async inspect(maxElements: number): Promise<AgentPageInspection> {
    const graph = await this.frameGraph()
    const snapshotId = `p${crypto.randomUUID().slice(0, 8)}`
    const inspected = new Map<string, FrameInspection>()
    const frameResults: AgentPageFrame[] = []

    for (const frame of graph.frames.values()) {
      try {
        const contextId = await this.isolatedWorld(frame.id)
        const local = await this.evaluate<LocalInspection>(
          inspectionExpression(snapshotId, frame.id, maxElements), contextId
        )
        inspected.set(frame.id, { frame, contextId, local })
        frameResults.push({
          frameId: frame.id,
          parentFrameId: frame.parentId,
          url: frame.url,
          inspected: true,
          elementCount: local.elements.length
        })
      } catch (error) {
        frameResults.push({
          frameId: frame.id,
          parentFrameId: frame.parentId,
          url: frame.url,
          inspected: false,
          elementCount: 0,
          error: errorMessage(error)
        })
      }
    }

    const elements: AgentPageElement[] = []
    const refs = new Map<string, FrameInspection>()
    for (const frame of inspected.values()) {
      const quadCache = new Map<string, number[]>()
      for (const local of frame.local.elements) {
        if (elements.length === maxElements) break
        try {
          elements.push(await this.normalizeElement(
            local, frame, graph.rootFrameId, graph.frames, inspected, quadCache
          ))
          refs.set(local.ref, frame)
        } catch (error) {
          const result = frameResults.find((candidate) => candidate.frameId === frame.frame.id)
          if (result) result.error = `Geometry normalization failed: ${errorMessage(error)}`
        }
      }
      if (elements.length === maxElements) break
    }

    this.snapshot = { id: snapshotId, rootFrameId: graph.rootFrameId, frames: graph.frames, inspected, refs }
    const root = inspected.get(graph.rootFrameId)?.local.viewport
    const viewport = root ?? await this.layoutViewport()
    const candidateCount = [...inspected.values()].reduce((sum, frame) => sum + frame.local.candidateCount, 0)
    return {
      snapshotId,
      coordinateSpace: COORDINATE_SPACE,
      viewport,
      elements,
      frames: frameResults,
      truncated: candidateCount > elements.length
    }
  }

  async click(ref: string): Promise<AgentPageClick> {
    const snapshot = this.snapshot
    const frame = snapshot?.refs.get(ref)
    if (!snapshot || !frame || !ref.startsWith(`${snapshot.id}:`)) {
      throw new Error('Element reference is stale or unknown; inspect the page again')
    }
    const prepared = await this.evaluate<PreparedClick>(
      prepareClickExpression(snapshot.id, ref), frame.contextId, true
    )
    frame.local.viewport.width = prepared.viewport.width
    frame.local.viewport.height = prepared.viewport.height
    const graph = await this.frameGraph()
    await this.scrollFrameChain(frame.frame.id, graph.rootFrameId, graph.frames, snapshot.inspected)
    const point = await this.toMainViewport(
      prepared.point,
      frame.frame.id,
      graph.rootFrameId,
      graph.frames,
      snapshot.inspected,
      new Map()
    )
    const hitTest = await this.hitTest(point)
    await this.dispatchClick(point)
    return { ref, point, coordinateSpace: COORDINATE_SPACE, hitTest }
  }

  async clickAt(point: ViewportPoint): Promise<AgentPageClick> {
    const viewport = await this.layoutViewport()
    if (point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height) {
      throw new Error(
        `Coordinate (${point.x}, ${point.y}) is outside the ${viewport.width}×${viewport.height} main viewport`
      )
    }
    const hitTest = await this.hitTest(point)
    await this.dispatchClick(point)
    return { point, coordinateSpace: COORDINATE_SPACE, hitTest }
  }

  private async normalizeElement(
    local: LocalElement,
    frame: FrameInspection,
    rootFrameId: string,
    frames: Map<string, FrameNode>,
    inspected: Map<string, FrameInspection>,
    quadCache: Map<string, number[]>
  ): Promise<AgentPageElement> {
    const quad: number[] = []
    for (let index = 0; index < local.quad.length; index += 2) {
      const point = await this.toMainViewport(
        { x: local.quad[index]!, y: local.quad[index + 1]! },
        frame.frame.id, rootFrameId, frames, inspected, quadCache
      )
      quad.push(point.x, point.y)
    }
    const center = await this.toMainViewport(
      local.center, frame.frame.id, rootFrameId, frames, inspected, quadCache
    )
    const xs = quad.filter((_, index) => index % 2 === 0)
    const ys = quad.filter((_, index) => index % 2 === 1)
    const left = Math.min(...xs)
    const right = Math.max(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    const rootViewport = inspected.get(rootFrameId)?.local.viewport
    const insideMainViewport = !rootViewport || (
      right > 0 && bottom > 0 && left < rootViewport.width && top < rootViewport.height
    )
    return {
      ...local,
      bounds: { x: left, y: top, width: right - left, height: bottom - top },
      center,
      quad,
      visible: local.visible && insideMainViewport,
      hitTestable: local.hitTestable && insideMainViewport,
      coordinateSpace: COORDINATE_SPACE
    }
  }

  private async toMainViewport(
    source: ViewportPoint,
    frameId: string,
    rootFrameId: string,
    frames: Map<string, FrameNode>,
    inspected: Map<string, FrameInspection>,
    quadCache: Map<string, number[]>
  ): Promise<ViewportPoint> {
    let point = source
    let currentId = frameId
    const visited = new Set<string>()
    while (currentId !== rootFrameId) {
      if (visited.has(currentId)) throw new Error(`Frame cycle at ${currentId}`)
      visited.add(currentId)
      const current = frames.get(currentId)
      if (!current?.parentId) throw new Error(`Frame ${currentId} is no longer attached to the main frame`)
      const viewport = inspected.get(currentId)?.local.viewport
      if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
        throw new Error(`Frame ${currentId} has no usable viewport`)
      }
      const parent = inspected.get(current.parentId)
      if (!parent) throw new Error(`Parent frame ${current.parentId} could not be inspected`)
      let quad = quadCache.get(currentId)
      if (!quad) {
        quad = await this.frameOwnerContentQuad(currentId, parent.contextId)
        quadCache.set(currentId, quad)
      }
      point = mapIntoQuad(point, viewport.width, viewport.height, quad)
      currentId = current.parentId
    }
    return point
  }

  private async frameOwnerContentQuad(frameId: string, parentContextId: number): Promise<number[]> {
    const owner = recordOf(await this.target.command('DOM.getFrameOwner', { frameId }))
    const backendNodeId = numberOf(owner?.backendNodeId)
    if (backendNodeId === null) throw new Error(`CDP did not return the owner of frame ${frameId}`)
    const content = await this.callNodeFunction<unknown>(backendNodeId, parentContextId, FRAME_OWNER_QUAD_FUNCTION)
    const quad = numberArray(content)
    if (!quad || quad.length !== 8) throw new Error(`CDP did not return an 8-point content quad for frame ${frameId}`)
    return quad
  }

  private async scrollFrameChain(
    frameId: string,
    rootFrameId: string,
    frames: Map<string, FrameNode>,
    inspected: Map<string, FrameInspection>
  ): Promise<void> {
    let currentId = frameId
    while (currentId !== rootFrameId) {
      const current = frames.get(currentId)
      if (!current?.parentId) throw new Error(`Frame ${currentId} is no longer attached to the main frame`)
      const parent = inspected.get(current.parentId)
      if (!parent) throw new Error(`Parent frame ${current.parentId} could not be inspected`)
      const owner = recordOf(await this.target.command('DOM.getFrameOwner', { frameId: currentId }))
      const backendNodeId = numberOf(owner?.backendNodeId)
      if (backendNodeId === null) throw new Error(`CDP did not return the owner of frame ${currentId}`)
      await this.callNodeFunction(backendNodeId, parent.contextId, SCROLL_FRAME_OWNER_FUNCTION, true)
      currentId = current.parentId
    }
  }

  private async frameGraph(): Promise<{ rootFrameId: string; frames: Map<string, FrameNode> }> {
    const response = recordOf(await this.target.command('Page.getFrameTree'))
    const root = recordOf(response?.frameTree)
    if (!root) throw new Error('CDP did not return a page frame tree')
    const frames = new Map<string, FrameNode>()
    const visit = (tree: Record<string, unknown>): void => {
      const raw = recordOf(tree.frame)
      const id = stringOf(raw?.id)
      if (!id) throw new Error('CDP returned a frame without an id')
      frames.set(id, { id, parentId: stringOf(raw?.parentId), url: stringOf(raw?.url) ?? '' })
      const children = Array.isArray(tree.childFrames) ? tree.childFrames : []
      for (const child of children) {
        const childTree = recordOf(child)
        if (childTree) visit(childTree)
      }
    }
    visit(root)
    const rootFrameId = stringOf(recordOf(root.frame)?.id)
    if (!rootFrameId) throw new Error('CDP did not return a main frame id')
    return { rootFrameId, frames }
  }

  private async isolatedWorld(frameId: string): Promise<number> {
    const response = recordOf(await this.target.command('Page.createIsolatedWorld', {
      frameId,
      worldName: WORLD_NAME,
      grantUniveralAccess: false
    }))
    const contextId = numberOf(response?.executionContextId)
    if (contextId === null) throw new Error(`CDP did not create an execution context for frame ${frameId}`)
    return contextId
  }

  private async evaluate<T>(expression: string, contextId: number, awaitPromise = false): Promise<T> {
    const response = recordOf(await this.target.command('Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise
    }))
    const exception = recordOf(response?.exceptionDetails)
    if (exception) {
      const detail = recordOf(exception.exception)
      throw new Error(stringOf(detail?.description) ?? stringOf(exception.text) ?? 'Page evaluation failed')
    }
    const result = recordOf(response?.result)
    if (!result || !('value' in result)) throw new Error('Page evaluation returned no value')
    return result.value as T
  }

  private async callNodeFunction<T>(
    backendNodeId: number,
    contextId: number,
    functionDeclaration: string,
    awaitPromise = false
  ): Promise<T> {
    const resolved = recordOf(await this.target.command('DOM.resolveNode', {
      backendNodeId, executionContextId: contextId
    }))
    const objectId = stringOf(recordOf(resolved?.object)?.objectId)
    if (!objectId) throw new Error(`CDP could not resolve backend node ${backendNodeId}`)
    try {
      const response = recordOf(await this.target.command('Runtime.callFunctionOn', {
        objectId, functionDeclaration, returnByValue: true, awaitPromise
      }))
      const exception = recordOf(response?.exceptionDetails)
      if (exception) throw new Error(stringOf(exception.text) ?? 'Frame owner evaluation failed')
      const result = recordOf(response?.result)
      if (!result || !('value' in result)) throw new Error('Frame owner evaluation returned no value')
      return result.value as T
    } finally {
      await this.target.command('Runtime.releaseObject', { objectId }).catch(() => {})
    }
  }

  private async hitTest(point: ViewportPoint): Promise<unknown> {
    return this.target.command('DOM.getNodeForLocation', {
      x: Math.round(point.x),
      y: Math.round(point.y),
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: false
    })
  }

  private async dispatchClick(point: ViewportPoint): Promise<void> {
    await this.target.command('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0
    })
    await this.target.command('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1
    })
    await this.target.command('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1
    })
  }

  private async layoutViewport(): Promise<AgentPageInspection['viewport']> {
    const response = recordOf(await this.target.command('Page.getLayoutMetrics'))
    const visual = recordOf(response?.cssVisualViewport) ?? recordOf(response?.visualViewport)
    const layout = recordOf(response?.cssLayoutViewport) ?? recordOf(response?.layoutViewport)
    const width = numberOf(visual?.clientWidth) ?? numberOf(layout?.clientWidth) ?? 0
    const height = numberOf(visual?.clientHeight) ?? numberOf(layout?.clientHeight) ?? 0
    return {
      width,
      height,
      deviceScaleFactor: 1,
      scrollX: numberOf(visual?.pageX) ?? numberOf(layout?.pageX) ?? 0,
      scrollY: numberOf(visual?.pageY) ?? numberOf(layout?.pageY) ?? 0
    }
  }
}
