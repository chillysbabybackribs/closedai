// Main-process fault handling for launch. Electron's default for an uncaught exception in the
// main process is a bare dialog and exit; a rejection nobody awaited is a console warning. Neither
// says what the app was doing, and the second silently leaves a half-started app. This owns:
// the bootstrap wrapper (a failure before the window exists is shown and ends the app), the
// process-level handlers (a stray fault after the window exists is logged with a `[main]` prefix
// and the app keeps running), and the child-process-gone log for GPU/utility losses. Every
// decision is a pure function so the policy is testable without Electron.

export type FaultKind = 'uncaughtException' | 'unhandledRejection'
export type FaultDisposition = 'quit' | 'continue'

/** The subset of Electron's `app.on('child-process-gone')` details that the log line uses. */
export type ChildProcessGone = { type: string; reason: string; exitCode?: number; name?: string; serviceName?: string }

export type CrashGuardApp = {
  on(event: 'child-process-gone', listener: (event: unknown, details: ChildProcessGone) => void): unknown
  exit(code?: number): void
}

export type CrashGuardHost = {
  app: CrashGuardApp
  process: Pick<NodeJS.Process, 'on'>
  showErrorBox: (title: string, content: string) => void
  /** Whether the app shell exists; a fault before it does means the launch itself failed. */
  hasWindow: () => boolean
  log?: Pick<Console, 'error' | 'warn'>
}

/** A one-line, human-readable account of any thrown value: name, message, and the first frame. */
export function describeFault(error: unknown): string {
  if (error instanceof Error) {
    const frame = error.stack?.split('\n').map((line) => line.trim()).find((line) => line.startsWith('at '))
    const head = error.name && error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message
    return frame ? `${head} (${frame})` : head
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

/**
 * Only an uncaught exception before the window exists ends the app: nothing was shown yet and
 * nothing can recover. Once the shell is up, an exception or a stray rejection from a background
 * service is logged and the app keeps running; quitting would lose the user's open chats over a
 * fault that a single provider or tab already contains.
 */
export function faultDisposition(kind: FaultKind, hasWindow: boolean): FaultDisposition {
  return kind === 'uncaughtException' && !hasWindow ? 'quit' : 'continue'
}

export function bootstrapErrorBox(error: unknown): { title: string; content: string } {
  return {
    title: 'ClosedAI could not start',
    content: `${describeFault(error)}\n\nThe app will close. If this keeps happening, start it from a terminal to read the full log.`
  }
}

export function childProcessGoneLine(details: ChildProcessGone): string {
  const which = [details.type, details.name ?? details.serviceName].filter(Boolean).join(' ')
  const exit = typeof details.exitCode === 'number' ? `, exit code ${details.exitCode}` : ''
  return `[main] ${which} process gone: ${details.reason}${exit}`
}

/** Run the bootstrap; a rejection is shown in a native error box and ends the app with status 1. */
export async function runBootstrap(main: () => Promise<void>, host: CrashGuardHost): Promise<void> {
  const log = host.log ?? console
  try {
    await main()
  } catch (error) {
    log.error('[main] bootstrap failed:', describeFault(error))
    const box = bootstrapErrorBox(error)
    host.showErrorBox(box.title, box.content)
    host.app.exit(1)
  }
}

export function installCrashGuard(host: CrashGuardHost): void {
  const log = host.log ?? console
  host.process.on('uncaughtException', (error: unknown, origin: string) => {
    const disposition = faultDisposition('uncaughtException', host.hasWindow())
    log.error(`[main] uncaught exception (${origin}), ${disposition === 'quit' ? 'quitting' : 'continuing'}:`, describeFault(error))
    if (disposition !== 'quit') return
    const box = bootstrapErrorBox(error)
    host.showErrorBox(box.title, box.content)
    host.app.exit(1)
  })
  host.process.on('unhandledRejection', (reason: unknown) => {
    log.error('[main] unhandled rejection, continuing:', describeFault(reason))
  })
  host.app.on('child-process-gone', (_event, details) => {
    log.warn(childProcessGoneLine(details))
  })
}
