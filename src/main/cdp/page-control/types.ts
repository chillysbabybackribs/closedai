export type ViewportPoint = { x: number; y: number }

export type ViewportBounds = ViewportPoint & {
  width: number
  height: number
}

export type AgentPageElement = {
  ref: string
  frameId: string
  tag: string
  role: string
  name: string
  text?: string
  bounds: ViewportBounds
  center: ViewportPoint
  quad: number[]
  quadSource: 'box_quad' | 'client_rect'
  coordinateSpace: 'main_viewport_css'
  visible: boolean
  hitTestable: boolean
  disabled: boolean
  checked?: boolean
  value?: string
}

export type AgentPageFrame = {
  frameId: string
  parentFrameId: string | null
  url: string
  inspected: boolean
  elementCount: number
  error?: string
}

export type AgentPageInspection = {
  snapshotId: string
  coordinateSpace: 'main_viewport_css'
  viewport: {
    width: number
    height: number
    deviceScaleFactor: number
    scrollX: number
    scrollY: number
  }
  elements: AgentPageElement[]
  frames: AgentPageFrame[]
  truncated: boolean
}

export type AgentPageClick = {
  ref?: string
  point: ViewportPoint
  coordinateSpace: 'main_viewport_css'
  hitTest: unknown
}
