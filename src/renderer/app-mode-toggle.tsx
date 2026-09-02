import type { JSX } from 'react'
import { Activity, MessageSquareText, Sparkles } from 'lucide-react'

export type AppMode = 'chat' | 'operations'

export function AppModeToggle({
  mode,
  onChange,
  chatAvailable = true
}: {
  mode: AppMode
  onChange: (mode: AppMode) => void
  chatAvailable?: boolean
}): JSX.Element {
  return (
    <>
      <div className="app-brand" aria-label="ClosedAI">
        <span className="app-brand-mark"><Sparkles size={12} fill="currentColor" /></span>
        <strong>ClosedAI</strong>
      </div>
      <div className="app-mode-toggle" role="group" aria-label="Workspace mode">
        <button
          type="button"
          className={mode === 'chat' ? 'is-active' : ''}
          disabled={!chatAvailable}
          aria-pressed={mode === 'chat'}
          onClick={() => onChange('chat')}
        >
          <MessageSquareText size={13} />
          Chat
        </button>
        <button
          type="button"
          className={mode === 'operations' ? 'is-active' : ''}
          aria-pressed={mode === 'operations'}
          onClick={() => onChange('operations')}
        >
          <Activity size={13} />
          Operations
          <span className="app-mode-attention">1</span>
        </button>
      </div>
    </>
  )
}
