import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_OPTIMIZE_CANCELLED, type AgentOptimizeRequest, type AgentOptimizeResult } from '../../shared/agent-optimizer.js'
import { errorMessage } from '../error-message.js'

// One optimize request at a time for the Build screen: a visible running state with the seconds
// it has taken, Cancel, and an error that says what failed. The hook only reports; the editor
// decides what to do with a result, so a failure or a cancel leaves every field as it was.

export type PromptOptimizerApi = {
  optimize: (request: AgentOptimizeRequest) => Promise<AgentOptimizeResult>
  cancelOptimize: (requestId: string) => Promise<void>
}

export type PromptOptimizer = {
  running: boolean
  /** Whole seconds the request in flight has taken. */
  seconds: number
  /** Why the last request failed; empty after a success, a cancel, or a new request. */
  error: string
  /** Resolves with the result, or null when the request failed or was cancelled. */
  run: (request: Omit<AgentOptimizeRequest, 'requestId'>) => Promise<AgentOptimizeResult | null>
  cancel: () => void
}

function bridge(): PromptOptimizerApi | null {
  const api = typeof window === 'undefined' ? undefined : window.closedai?.agentLibrary
  // A renderer that hot-reloaded ahead of the main process has no optimize channel yet.
  return api && typeof api.optimize === 'function' ? api : null
}

export function usePromptOptimizer(api: () => PromptOptimizerApi | null = bridge): PromptOptimizer {
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const active = useRef<string | null>(null)

  useEffect(() => {
    if (startedAt === null) return
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  const cancel = useCallback((): void => {
    const requestId = active.current
    if (!requestId) return
    active.current = null
    setStartedAt(null)
    void api()?.cancelOptimize(requestId).catch(() => {})
  }, [api])

  // Leaving the screen abandons the request; nothing is waiting for its result any more.
  useEffect(() => cancel, [cancel])

  const run = useCallback(async (request: Omit<AgentOptimizeRequest, 'requestId'>): Promise<AgentOptimizeResult | null> => {
    const target = api()
    if (!target) {
      setError('Optimizing needs the app to restart once to load its new main process')
      return null
    }
    const requestId = crypto.randomUUID()
    active.current = requestId
    setError('')
    setSeconds(0)
    setStartedAt(Date.now())
    try {
      const result = await target.optimize({ ...request, requestId })
      return active.current === requestId ? result : null
    } catch (failure) {
      const message = errorMessage(failure, 'Could not optimize the description')
      if (active.current === requestId && !message.includes(AGENT_OPTIMIZE_CANCELLED)) setError(message)
      return null
    } finally {
      if (active.current === requestId) {
        active.current = null
        setStartedAt(null)
      }
    }
  }, [api])

  return { running: startedAt !== null, seconds, error, run, cancel }
}
