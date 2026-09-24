import { useState } from 'react'
import { errorMessage } from '../error-message.js'

// Pause, Resume, and Stop ask main to change a run; the surface only tracks the round trip so
// its buttons disable while one is in flight and a refusal shows beside them.

export type AgentRunAction = {
  busy: boolean
  error: string
  act: (action: () => Promise<unknown>) => Promise<void>
}

export function useAgentRunAction(): AgentRunAction {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(errorMessage(failure, 'The agent did not respond'))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, act }
}
