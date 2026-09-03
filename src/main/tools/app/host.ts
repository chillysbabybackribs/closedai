export type AppWaitOptions = {
  selector?: string
  text?: string
  condition: 'visible' | 'hidden'
  timeoutMs: number
}

export type AppInspectOptions = {
  maxElements: number
  query?: string
  surface?: 'shell' | 'side-drawer' | 'chat' | 'browser' | 'browser-downloads'
  includeText: boolean
}

export type AppWaitResult = AppWaitOptions & {
  reached: boolean
  elapsedMs: number
  selectorMatched: boolean | null
  textMatched: boolean | null
  matches: AppElementMatch[]
}

export type AppElementMatch = {
  tag: string
  role: string
  name: string
  text: string
  state: Record<string, boolean | string>
  bounds: { x: number; y: number; width: number; height: number }
}

export type AppClickTarget = {
  ref?: string
  selector?: string
  x?: number
  y?: number
}

export type AppTypeTarget = {
  ref?: string
  selector?: string
  text: string
  clear: boolean
}

export type AppScrollTarget = {
  ref?: string
  selector?: string
  deltaX: number
  deltaY: number
}

export type AppToolHost = {
  inspect(options: AppInspectOptions): Promise<unknown>
  click(target: AppClickTarget): Promise<unknown>
  typeText(target: AppTypeTarget): Promise<unknown>
  pressKey(key: string, modifiers: string[]): Promise<unknown>
  scroll(target: AppScrollTarget): Promise<unknown>
  waitFor(options: AppWaitOptions, signal: AbortSignal): Promise<AppWaitResult>
}

export type AppHostProvider = () => AppToolHost | null

export function requireApp(provider: AppHostProvider): AppToolHost {
  const host = provider()
  if (!host) throw new Error('ClosedAI app automation is not available yet')
  return host
}
