import { spawn } from 'node:child_process'
import { ownProcessGroup, stopProcessGroup, trackProcessGroup } from '../process-tree.js'

/** Bounded one-shot process; prompts go through stdin, never shell interpolation or argv. */
export function titleProcess(binary: string, args: string[], cwd: string, input: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], ...ownProcessGroup() })
    trackProcessGroup(child)
    let output = ''
    let failed = false
    const abort = (): void => { failed = true; stopProcessGroup(child) }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (output.length + chunk.length > 64_000) abort()
      else output += chunk
    })
    // Drain diagnostics without recording conversation text or provider credentials.
    child.stderr.resume()
    child.stdin.on('error', abort)
    child.once('error', (error) => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (failed || code !== 0 || signal.aborted) reject(new Error('Title generation did not complete'))
      else resolve(output)
    })
    child.stdin.end(input)
    if (signal.aborted) abort()
  })
}
