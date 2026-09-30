import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { AppServerClient } from '../../app-server-client.js'
import { codexExecutable } from '../../codex-workspace-runtime.js'
import { startThreadParams } from '../../chat-context/thread-params.js'
import { AppServerToolCalls } from '../../tools/app-server-tools.js'
import { type ToolRegistry } from '../../tools/registry.js'
import { loadClaudeSdk } from '../../claude/claude-sdk.js'
import { claudeQueryOptions } from '../../claude/claude-options.js'
import { claudeMcpServers } from '../../claude/claude-tools.js'
import { AntigravityToolBridge } from '../../antigravity/antigravity-mcp.js'
import { ensureAntigravityProfile } from '../../antigravity/antigravity-profile.js'
import { antigravityBinary, antigravityChatArgs } from '../../antigravity/antigravity-cli.js'

export type BenchmarkProvider = 'codex' | 'claude' | 'antigravity'
export type ProviderRun = {
  provider: BenchmarkProvider; cwd: string; stateDir: string; prompt: string; registry: ToolRegistry
  model: string | null; signal: AbortSignal
  submitted: () => void
  modelObserved: (model: string) => void
}

export async function runProvider(run: ProviderRun): Promise<void> {
  if (run.provider === 'codex') return codex(run)
  if (run.provider === 'claude') return claude(run)
  return antigravity(run)
}

async function codex(run: ProviderRun) {
  const client = new AppServerClient(codexExecutable(), run.cwd)
  const toolHost = new AppServerToolCalls(run.registry, client, 'benchmark')
  const abort = () => client.stop()
  run.signal.addEventListener('abort', abort, { once: true })
  try {
    await client.start()
    const response = await client.request<{ thread: { id: string }; model?: string }>('thread/start', startThreadParams(run.cwd, run.registry, { model: run.model, effort: null }))
    if (response.model) run.modelObserved(response.model)
    client.on('request', request => {
      if (!toolHost.handle(request)) client.respondWithError(request.id, -32601, 'Unsupported benchmark request')
    })
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new Error('Provider timed out'))
      run.signal.addEventListener('abort', onAbort, { once: true })
      client.on('notification', notification => {
        if (notification.method !== 'turn/completed') return
        run.signal.removeEventListener('abort', onAbort)
        const turn = (notification.params as { turn?: { status?: string } }).turn
        if (turn?.status !== 'completed') reject(new Error(`Turn ended: ${turn?.status}`))
        else resolve()
      })
      run.submitted()
      void client.request('turn/start', { threadId: response.thread.id, input: [{ type: 'text', text: run.prompt }] })
        .catch(reject)
    })
  } finally {
    run.signal.removeEventListener('abort', abort)
    client.stop()
  }
}

async function claude(run: ProviderRun) {
  const sdk = await loadClaudeSdk()
  const controller = new AbortController()
  const abort = () => controller.abort()
  run.signal.addEventListener('abort', abort, { once: true })
  const options = claudeQueryOptions({ cwd: run.cwd, model: run.model, effort: null, adaptiveThinking: true,
    resume: null, runtimeId: randomUUID(), seamlessRotation: false,
    mcpServers: claudeMcpServers(sdk, run.registry, () => ({ paneId: 'benchmark', threadId: 'benchmark', turnId: 'benchmark' })) })
  run.submitted()
  const query = sdk.query({ prompt: run.prompt, options: { ...options, abortController: controller, persistSession: false } })
  try {
    for await (const message of query) {
      if (message.type === 'system' && message.subtype === 'init') run.modelObserved(message.model)
      if (message.type === 'result' && message.is_error) throw new Error(`Claude failed: ${message.subtype}`)
    }
  } finally { query.close(); run.signal.removeEventListener('abort', abort) }
}

async function antigravity(run: ProviderRun) {
  // Unique registration names; cleanup removes only our entries, never the running app's entries.
  const bridge = new AntigravityToolBridge(run.registry, { profileKey: `retrieval_eval_${randomUUID().replaceAll('-', '')}` })
  bridge.bind('benchmark', { paneId: 'benchmark', threadId: 'benchmark', turnId: 'benchmark' })
  try {
    await bridge.start()
    const profile = await ensureAntigravityProfile(run.stateDir, { cwd: run.cwd })
    const streamArgs = antigravityChatArgs({ workspace: run.cwd, model: run.model, resume: null, agent: { name: profile.agentName, root: profile.root } })
    // One-shot print avoids requiring a persistent stdin stream in this single-turn pilot.
    const args = streamArgs.filter((arg, index) => arg !== '--input-format' && streamArgs[index - 1] !== '--input-format')
      .map(arg => arg === '--print=' ? `--print=${run.prompt}` : arg)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(antigravityBinary(), args, { cwd: run.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
      let buffer = ''; let stderr = ''; let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        run.signal.removeEventListener('abort', abort)
        try { if (child.pid) process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
        if (error) reject(error); else resolve()
      }
      const abort = () => finish(new Error('Provider timed out'))
      run.signal.addEventListener('abort', abort, { once: true })
      child.on('error', finish)
      child.on('close', code => finish(new Error(`Antigravity exited ${code}: ${stderr}`)))
      child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000) })
      child.stdout.on('data', chunk => {
        buffer += String(chunk)
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          try {
            const event = JSON.parse(line)
            const parsed = antigravityEvent(event)
            if (parsed.model) { run.modelObserved(parsed.model); console.log(`Antigravity initialized: ${parsed.model}`) }
            if (parsed.done) finish(parsed.error ? new Error(parsed.error) : undefined)
          } catch { /* CLI banner/non-JSON */ }
        }
      })
      child.stdin.on('error', finish)
      run.submitted()
      child.stdin.end()
    })
  } finally { await bridge.stop() }
}


export function antigravityEvent(event: Record<string, unknown>): { model?: string; done?: boolean; error?: string } {
  if (event.event === 'init') {
    const init = event.init as { model?: unknown } | undefined
    return typeof init?.model === 'string' ? { model: init.model } : {}
  }
  if (event.event !== 'result') return {}
  const result = event.result as { status?: string; error?: string } | undefined
  return { done: true, ...(result?.status === 'SUCCESS' ? {} : { error: result?.error ?? `Antigravity result: ${result?.status ?? 'missing'}` }) }
}
