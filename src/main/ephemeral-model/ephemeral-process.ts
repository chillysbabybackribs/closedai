import { spawn } from 'node:child_process'
import { ownProcessGroup, stopProcessGroup, trackProcessGroup } from '../process-tree.js'

/** Output past this many characters stops a request sized for a short answer (a chat title). */
export const EPHEMERAL_OUTPUT_CHARS = 64_000

export type EphemeralProcessOptions = {
  /** What the request is for, as the subject of a failure message: "Title generation". */
  label: string
  maxOutputChars?: number
}

/** Bounded one-shot process; prompts go through stdin, never shell interpolation or argv. */
export function ephemeralProcess(binary: string, args: string[], cwd: string, input: string, signal: AbortSignal, options: EphemeralProcessOptions): Promise<string> {
  signal.throwIfAborted()
  const limit = options.maxOutputChars ?? EPHEMERAL_OUTPUT_CHARS
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], ...ownProcessGroup() })
    trackProcessGroup(child)
    let output = ''
    let failed = false
    const abort = (): void => { failed = true; stopProcessGroup(child) }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (output.length + chunk.length > limit) abort()
      else output += chunk
    })
    // Drain diagnostics without recording conversation text or provider credentials.
    child.stderr.resume()
    child.stdin.on('error', abort)
    child.once('error', (error) => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (failed || code !== 0 || signal.aborted) reject(new Error(`${options.label} did not complete`))
      else resolve(output)
    })
    child.stdin.end(input)
    if (signal.aborted) abort()
  })
}
