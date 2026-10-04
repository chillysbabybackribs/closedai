import type { JSX, ReactNode } from 'react'
import { ArrowLeft } from '../icons/index.js'
import { Button } from '../../components/ui/button.js'

// The one-line header every Agents screen starts with. The Library shows its title and the
// Runs / New agent actions; pushed screens (Build, Runs) show a back control and their title.

export function AgentScreenHeader({ title, onBack, children }: {
  title: string
  /** Present on pushed screens: returns to the Library. */
  onBack?: () => void
  children?: ReactNode
}): JSX.Element {
  return (
    <header className="agent-screen-header">
      {onBack && (
        <Button type="button" variant="ghost" size="xs" data-ui="agents.back" className="agent-screen-back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> Agents
        </Button>
      )}
      <h2 className="agent-screen-title">{title}</h2>
      <div className="agent-screen-actions">{children}</div>
    </header>
  )
}
