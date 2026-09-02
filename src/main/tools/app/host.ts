export type AppWaitOptions = {
  selector?: string
  text?: string
  condition: 'visible' | 'hidden'
  timeoutMs: number
}

export type AppWaitResult = AppWaitOptions & {
  reached: boolean
  elapsedMs: number
  selectorMatched: boolean | null
  textMatched: boolean | null
}

export type AppToolHost = {
  inspect(maxElements: number): Promise<unknown>
  click(ref: string): Promise<unknown>
  typeText(ref: string, text: string, clear: boolean): Promise<unknown>
  pressKey(key: string, modifiers: string[]): Promise<unknown>
  scroll(ref: string | undefined, deltaX: number, deltaY: number): Promise<unknown>
  waitFor(options: AppWaitOptions, signal: AbortSignal): Promise<AppWaitResult>
}

export type AppHostProvider = () => AppToolHost | null

export function requireApp(provider: AppHostProvider): AppToolHost {
  const host = provider()
  if (!host) throw new Error('ClosedAI app automation is not available yet')
  return host
}
